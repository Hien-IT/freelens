/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! `download-json-channel`: a GET of a URL, read as JSON, through the proxy of
//! the settings and with their choice about untrusted authorities, answered as
//! the Electron build answers it (`specs/007-main-foundation/contracts/foundation-channels.md`,
//! "download-json-channel"; research R9).

use std::io;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use http_body_util::{BodyExt, Empty};
use hyper::body::Bytes;
use hyper::header::{HOST, LOCATION};
use hyper::{Request, StatusCode};
use hyper_util::rt::TokioIo;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::WebPkiSupportedAlgorithms;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use serde_json::{Value, json};
use tauri::Url;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;

use crate::messaging::{Channels, DuplicateChannel, RequestChannel};
use crate::stores::Stores;

pub const DOWNLOAD_JSON: RequestChannel<Value, Value> =
    RequestChannel::new("download-json-channel");

/// Redirects `fetch` follows before it gives up.
const MAX_REDIRECTS: usize = 20;

/// The authorities a server is checked against: the system's in the
/// application, a test's own in the tests.
#[derive(Debug, Clone)]
pub enum Trust {
    Platform,
    Roots(Vec<CertificateDer<'static>>),
}

/// The proxy of the settings, in the schemes the Electron build supports.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Proxy {
    /// `http:`, or `https:` with `tls`: a `CONNECT` tunnel.
    Tunnel { host: String, port: u16, tls: bool },
    /// `socks:`, `socks5:` or `socks5h:`: SOCKS5, the name resolved by the proxy.
    Socks { host: String, port: u16 },
}

/// Reads the `httpsProxy` setting as `createHttpsProxyAgent` does.
fn proxy_of(setting: Option<&str>) -> Result<Option<Proxy>, String> {
    let Some(setting) = setting.filter(|setting| !setting.is_empty()) else {
        return Ok(None);
    };
    let setting = match setting.get(..8) {
        Some(prefix) if prefix.eq_ignore_ascii_case("socks5h:") => {
            format!("socks5:{}", &setting[8..])
        }
        _ => setting.to_string(),
    };
    let url = Url::parse(&setting).map_err(|_| "Invalid URL".to_string())?;
    let host = url.host_str().unwrap_or_default().to_string();
    let port = |default: u16| url.port().unwrap_or(default);
    match url.scheme() {
        "http" => Ok(Some(Proxy::Tunnel {
            host,
            port: port(80),
            tls: false,
        })),
        "https" => Ok(Some(Proxy::Tunnel {
            host,
            port: port(443),
            tls: true,
        })),
        "socks" | "socks5" => Ok(Some(Proxy::Socks {
            host,
            port: port(1080),
        })),
        scheme => Err(format!(
            "Unsupported proxy URL scheme \"{scheme}:\" in the HTTP Proxy preference: use http:, https: or socks5:"
        )),
    }
}

/// Accepts any certificate, as Node does with `rejectUnauthorized: false`,
/// while still checking that the handshake was signed by it.
#[derive(Debug)]
struct AcceptAny(WebPkiSupportedAlgorithms);

impl ServerCertVerifier for AcceptAny {
    fn verify_server_cert(
        &self,
        _: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.0)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.0)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.supported_schemes()
    }
}

fn tls_config(trust: &Trust, allow_untrusted: bool) -> Result<ClientConfig, rustls::Error> {
    use rustls_platform_verifier::BuilderVerifierExt;

    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let algorithms = provider.signature_verification_algorithms;
    let builder = ClientConfig::builder_with_provider(Arc::clone(&provider))
        .with_safe_default_protocol_versions()?;
    let mut config = if allow_untrusted {
        builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(AcceptAny(algorithms)))
            .with_no_client_auth()
    } else {
        match trust {
            Trust::Platform => builder.with_platform_verifier()?.with_no_client_auth(),
            Trust::Roots(roots) => {
                let mut store = RootCertStore::empty();
                for root in roots {
                    store.add(root.clone())?;
                }
                builder.with_root_certificates(store).with_no_client_auth()
            }
        }
    };
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(config)
}

trait Stream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Stream for T {}

async fn with_tls(
    stream: Box<dyn Stream>,
    host: &str,
    config: &Arc<ClientConfig>,
) -> io::Result<Box<dyn Stream>> {
    let name = ServerName::try_from(host.to_string()).map_err(io::Error::other)?;
    let stream = TlsConnector::from(Arc::clone(config))
        .connect(name, stream)
        .await?;
    Ok(Box::new(stream))
}

/// Asks the proxy to open a tunnel to `host:port`.
async fn tunnel(stream: &mut Box<dyn Stream>, host: &str, port: u16) -> io::Result<()> {
    let authority = authority(host, port);
    stream
        .write_all(format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n").as_bytes())
        .await?;
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > 16 * 1024 {
            return Err(io::Error::other(
                "the proxy's answer to CONNECT is too long",
            ));
        }
        let byte = stream.read_u8().await?;
        head.push(byte);
    }
    let status = String::from_utf8_lossy(&head)
        .split_whitespace()
        .nth(1)
        .unwrap_or_default()
        .to_string();
    if status != "200" {
        return Err(io::Error::other(format!(
            "Proxy response ({status}) !== 200 when HTTP Tunneling"
        )));
    }
    Ok(())
}

/// The SOCKS5 handshake without authentication, the name sent to the proxy.
async fn socks5(stream: &mut TcpStream, host: &str, port: u16) -> io::Result<()> {
    stream.write_all(&[5, 1, 0]).await?;
    let mut choice = [0u8; 2];
    stream.read_exact(&mut choice).await?;
    if choice != [5, 0] {
        return Err(io::Error::other("the SOCKS5 proxy refused the request"));
    }
    let name = host.as_bytes();
    let length = u8::try_from(name.len()).map_err(io::Error::other)?;
    let mut request = vec![5, 1, 0, 3, length];
    request.extend_from_slice(name);
    request.extend_from_slice(&port.to_be_bytes());
    stream.write_all(&request).await?;
    let mut reply = [0u8; 4];
    stream.read_exact(&mut reply).await?;
    if reply[1] != 0 {
        return Err(io::Error::other(format!(
            "the SOCKS5 proxy could not connect (reply {})",
            reply[1]
        )));
    }
    let address = match reply[3] {
        1 => 4,
        4 => 16,
        3 => usize::from(stream.read_u8().await?),
        kind => {
            return Err(io::Error::other(format!(
                "unknown SOCKS5 address type {kind}"
            )));
        }
    };
    let mut rest = vec![0u8; address + 2];
    stream.read_exact(&mut rest).await?;
    Ok(())
}

fn authority(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

async fn connect(
    url: &Url,
    proxy: Option<&Proxy>,
    config: &Arc<ClientConfig>,
) -> io::Result<Box<dyn Stream>> {
    let host = url
        .host_str()
        .ok_or_else(|| io::Error::other("the URL has no host"))?
        .trim_matches(['[', ']']);
    let port = url
        .port_or_known_default()
        .ok_or_else(|| io::Error::other("the URL has no port"))?;
    let stream: Box<dyn Stream> = match proxy {
        None => Box::new(TcpStream::connect((host, port)).await?),
        Some(Proxy::Tunnel {
            host: proxy_host,
            port: proxy_port,
            tls,
        }) => {
            let tcp: Box<dyn Stream> =
                Box::new(TcpStream::connect((proxy_host.as_str(), *proxy_port)).await?);
            let mut stream = if *tls {
                with_tls(tcp, proxy_host, config).await?
            } else {
                tcp
            };
            tunnel(&mut stream, host, port).await?;
            stream
        }
        Some(Proxy::Socks {
            host: proxy_host,
            port: proxy_port,
        }) => {
            let mut tcp = TcpStream::connect((proxy_host.as_str(), *proxy_port)).await?;
            socks5(&mut tcp, host, port).await?;
            Box::new(tcp)
        }
    };
    if url.scheme() == "https" {
        with_tls(stream, host, config).await
    } else {
        Ok(stream)
    }
}

struct Answer {
    status: StatusCode,
    reason: String,
    location: Option<String>,
    body: Bytes,
}

async fn get(
    url: &Url,
    proxy: Option<&Proxy>,
    config: &Arc<ClientConfig>,
    read_body: bool,
) -> Result<Answer, Box<dyn std::error::Error + Send + Sync>> {
    let stream = connect(url, proxy, config).await?;
    let (mut sender, connection) =
        hyper::client::conn::http1::handshake(TokioIo::new(stream)).await?;
    tokio::spawn(connection);
    let host = match url.port() {
        Some(port) => authority(url.host_str().unwrap_or_default(), port),
        None => url.host_str().unwrap_or_default().to_string(),
    };
    let target = match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_string(),
    };
    let request = Request::get(target)
        .header(HOST, host)
        .body(Empty::<Bytes>::new())?;
    let response = sender.send_request(request).await?;
    let status = response.status();
    let reason = response
        .extensions()
        .get::<hyper::ext::ReasonPhrase>()
        .map(|phrase| String::from_utf8_lossy(phrase.as_bytes()).into_owned())
        .unwrap_or_else(|| status.canonical_reason().unwrap_or_default().to_string());
    let location = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = if read_body {
        response.into_body().collect().await?.to_bytes()
    } else {
        Bytes::new()
    };
    Ok(Answer {
        status,
        reason,
        location,
        body,
    })
}

/// The GET of `fetch`, redirects followed, then the body as JSON.
async fn fetch_json(
    address: &str,
    proxy: Option<&Proxy>,
    config: &Arc<ClientConfig>,
) -> Result<Value, String> {
    let mut url = Url::parse(address).map_err(|_| format!("Failed to parse URL from {address}"))?;
    for _ in 0..=MAX_REDIRECTS {
        let answer = get(&url, proxy, config, true)
            .await
            .map_err(|error| format!("fetch failed: {error}"))?;
        let redirects = matches!(answer.status.as_u16(), 301 | 302 | 303 | 307 | 308);
        if let (true, Some(location)) = (redirects, &answer.location) {
            url = url
                .join(location)
                .map_err(|error| format!("fetch failed: {error}"))?;
            continue;
        }
        if !answer.status.is_success() {
            let parts = [answer.status.as_u16().to_string(), answer.reason];
            return Err(parts
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(": "));
        }
        let text = String::from_utf8_lossy(&answer.body);
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
        return serde_json::from_str(text).map_err(|error| error.to_string());
    }
    Err("fetch failed: redirect count exceeded".into())
}

/// The status a GET of `address` ends with, redirects followed as `fetch`
/// follows them, without a proxy and without reading the body: the request of
/// a web link's check (`specs/008-main-catalog`, research R9).
pub async fn status_of(address: &str, trust: &Trust) -> Result<u16, String> {
    let config = Arc::new(tls_config(trust, false).map_err(|error| error.to_string())?);
    let mut url = Url::parse(address).map_err(|_| format!("Failed to parse URL from {address}"))?;
    for _ in 0..=MAX_REDIRECTS {
        let answer = get(&url, None, &config, false)
            .await
            .map_err(|error| format!("fetch failed: {error}"))?;
        let redirects = matches!(answer.status.as_u16(), 301 | 302 | 303 | 307 | 308);
        if let (true, Some(location)) = (redirects, &answer.location) {
            url = url
                .join(location)
                .map_err(|error| format!("fetch failed: {error}"))?;
            continue;
        }
        return Ok(answer.status.as_u16());
    }
    Err("fetch failed: redirect count exceeded".into())
}

/// `formatDuration` of `@freelensapp/utilities`, compact, as the timeout
/// message of the Electron build writes it.
pub fn format_duration(millis: f64) -> String {
    let meaningful = |values: &[(f64, &str)]| {
        values
            .iter()
            .filter(|(value, _)| *value > 0.0)
            .map(|(value, unit)| format!("{value}{unit}"))
            .collect::<String>()
    };
    let total_seconds = (millis / 1000.0).floor();
    let total_minutes = (total_seconds / 60.0).floor();
    let total_hours = (total_minutes / 60.0).floor();
    let total_days = (total_hours / 24.0).floor();
    let days_to_months = 4800.0 / 146_097.0;
    let months_to_days = 146_097.0 / 4800.0;
    let days_per_year = 146_097.0 / 400.0;
    let parts_seconds = total_seconds % 60.0;
    let parts_minutes = total_minutes % 60.0;
    let parts_hours = total_hours % 24.0;
    let parts_days = total_days - ((total_days * days_to_months).floor() * months_to_days).ceil();

    let seconds = (millis / 1000.0).floor();
    if seconds < 0.0 {
        return "0s".into();
    }
    if seconds < 120.0 {
        return format!("{seconds}s");
    }
    let minutes = (millis / 60_000.0).floor();
    if minutes < 10.0 {
        return meaningful(&[(minutes, "m"), (parts_seconds, "s")]);
    }
    if minutes < 180.0 {
        return format!("{minutes}m");
    }
    let hours = (millis / 3_600_000.0).floor();
    if hours < 8.0 {
        return meaningful(&[(hours, "h"), (parts_minutes, "m")]);
    }
    if hours < 48.0 {
        return format!("{hours}h");
    }
    let days = (millis / 86_400_000.0).floor();
    if days < 8.0 {
        return meaningful(&[(days, "d"), (parts_hours, "h")]);
    }
    let years = (millis / 86_400_000.0 / days_per_year).floor();
    if years < 2.0 {
        return format!("{days}d");
    }
    if years < 8.0 {
        return meaningful(&[(years, "y"), (parts_days, "d")]);
    }
    format!("{years}y")
}

struct Downloader {
    stores: Stores,
    trust: Trust,
    /// The configuration last built, with the `allowUntrustedCAs` it was built for.
    config: Mutex<Option<(bool, Arc<ClientConfig>)>>,
}

impl Downloader {
    fn config(&self, allow_untrusted: bool) -> Result<Arc<ClientConfig>, String> {
        let mut cached = self.config.lock().expect("download lock");
        if let Some((built_for, config)) = cached.as_ref()
            && *built_for == allow_untrusted
        {
            return Ok(Arc::clone(config));
        }
        let config =
            Arc::new(tls_config(&self.trust, allow_untrusted).map_err(|error| error.to_string())?);
        *cached = Some((allow_untrusted, Arc::clone(&config)));
        Ok(config)
    }

    async fn download(&self, request: Value) -> Value {
        let preferences = self.stores.preferences();
        let address = request
            .get("url")
            .map(|url| url.as_str().map_or_else(|| url.to_string(), str::to_string))
            .unwrap_or_else(|| "undefined".into());
        let timeout = request
            .get("opts")
            .and_then(|opts| opts.get("timeout"))
            .and_then(Value::as_f64)
            .filter(|timeout| *timeout != 0.0);
        let result = async {
            let proxy = proxy_of(preferences.https_proxy.as_deref())?;
            let config = self.config(preferences.allow_untrusted_cas)?;
            let fetching = fetch_json(&address, proxy.as_ref(), &config);
            match timeout {
                Some(millis) => tokio::time::timeout(
                    Duration::from_secs_f64(millis.max(0.0) / 1000.0),
                    fetching,
                )
                .await
                .unwrap_or_else(|_| {
                    Err(format!(
                        "Operation timed out: timeout {}",
                        format_duration(millis)
                    ))
                }),
                None => fetching.await,
            }
        }
        .await;
        match result {
            Ok(response) => json!({"callWasSuccessful": true, "response": response}),
            Err(error) => json!({"callWasSuccessful": false, "error": error}),
        }
    }
}

pub fn register(
    channels: &mut Channels,
    stores: Stores,
    trust: Trust,
) -> Result<(), DuplicateChannel> {
    let downloader = Arc::new(Downloader {
        stores,
        trust,
        config: Mutex::new(None),
    });
    channels.answer(DOWNLOAD_JSON, move |request, _| {
        let downloader = Arc::clone(&downloader);
        async move { Ok(downloader.download(request).await) }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations_are_written_as_format_duration_writes_them() {
        for (millis, text) in [
            (0.0, "0s"),
            (1500.0, "1s"),
            (30_000.0, "30s"),
            (119_999.0, "119s"),
            (120_000.0, "2m"),
            (150_000.0, "2m30s"),
            (600_000.0, "10m"),
            (10_800_000.0, "3h"),
            (12_600_000.0, "3h30m"),
            (90_000_000.0, "25h"),
            (180_000_000.0, "2d2h"),
        ] {
            assert_eq!(format_duration(millis), text, "for {millis}");
        }
    }

    #[test]
    fn the_proxy_setting_is_read_as_the_electron_build_reads_it() {
        assert_eq!(proxy_of(None), Ok(None));
        assert_eq!(proxy_of(Some("")), Ok(None));
        assert_eq!(
            proxy_of(Some("http://proxy:3128")),
            Ok(Some(Proxy::Tunnel {
                host: "proxy".into(),
                port: 3128,
                tls: false
            }))
        );
        assert_eq!(
            proxy_of(Some("https://proxy")),
            Ok(Some(Proxy::Tunnel {
                host: "proxy".into(),
                port: 443,
                tls: true
            }))
        );
        for setting in [
            "socks5://proxy:1080",
            "SOCKS5H://proxy:1080",
            "socks://proxy:1080",
        ] {
            assert_eq!(
                proxy_of(Some(setting)),
                Ok(Some(Proxy::Socks {
                    host: "proxy".into(),
                    port: 1080
                })),
                "for {setting}"
            );
        }
        assert_eq!(
            proxy_of(Some("ftp://x")),
            Err("Unsupported proxy URL scheme \"ftp:\" in the HTTP Proxy preference: use http:, https: or socks5:".into())
        );
        assert_eq!(proxy_of(Some("not a url")), Err("Invalid URL".into()));
    }
}
