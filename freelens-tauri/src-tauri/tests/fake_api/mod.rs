/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! A fake Kubernetes API server for the tests of the cluster connection
//! (`specs/009-main-cluster-connection/research.md`, R18): HTTP/1.1, plain or
//! TLS with certificates `openssl` makes in a temporary directory, answers
//! scripted by method and path, streamed answers for watches, and a record of
//! every request. Also the kubeconfig files and credential plugins the tests
//! point at it. Integration tests use it with `mod fake_api;`, unit tests with
//! `#[path]`.

#![allow(dead_code)]

use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rustls::DigitallySignedStruct;
use rustls::client::danger::HandshakeSignatureValid;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, UnixTime};
use rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use rustls::{DistinguishedName, SignatureScheme};
use serde_json::{Value, json};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_rustls::TlsAcceptor;

/// A new empty directory under the system's temporary directory.
pub fn temp_dir(name: &str) -> PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "freelens-fake-api-{}-{}-{name}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

// ---------------------------------------------------------------------------
// Certificates

/// PEM and DER of a certificate authority, a server certificate for
/// `127.0.0.1` and `localhost`, and a client certificate, all made by
/// `openssl` when the test runs; no key is kept in the repository.
pub struct Certificates {
    pub ca_pem: String,
    pub server_cert: CertificateDer<'static>,
    pub server_key: PrivateKeyDer<'static>,
    pub client_cert_pem: String,
    pub client_key_pem: String,
    pub client_cert_der: Vec<u8>,
}

pub fn certificates(dir: &Path) -> Certificates {
    let run = |args: &[&str]| {
        let status = std::process::Command::new("openssl")
            .args(args)
            .current_dir(dir)
            .stderr(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "openssl {args:?}");
    };
    fs::write(
        dir.join("ca.cnf"),
        "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=fake-api-ca\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n",
    )
    .unwrap();
    fs::write(
        dir.join("server.ext"),
        "subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature\n",
    )
    .unwrap();
    fs::write(
        dir.join("client.ext"),
        "basicConstraints=critical,CA:FALSE\nextendedKeyUsage=clientAuth\nkeyUsage=critical,digitalSignature\n",
    )
    .unwrap();
    let ec = [
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
    ];
    let mut ca = vec!["req", "-x509"];
    ca.extend(ec);
    ca.extend([
        "-keyout",
        "ca.key.tmp",
        "-out",
        "ca.pem.tmp",
        "-days",
        "2",
        "-config",
        "ca.cnf",
    ]);
    run(&ca);
    for (name, subject) in [("server", "/CN=127.0.0.1"), ("client", "/CN=fake-user")] {
        let mut req = vec!["req"];
        req.extend(ec);
        let key = format!("{name}.key.tmp");
        let csr = format!("{name}.csr.tmp");
        req.extend(["-keyout", &key, "-out", &csr, "-subj", subject]);
        run(&req);
        let cert = format!("{name}.pem.tmp");
        let ext = format!("{name}.ext");
        run(&[
            "x509",
            "-req",
            "-in",
            &csr,
            "-CA",
            "ca.pem.tmp",
            "-CAkey",
            "ca.key.tmp",
            "-CAcreateserial",
            "-out",
            &cert,
            "-days",
            "2",
            "-extfile",
            &ext,
        ]);
        let der = format!("{name}.der.tmp");
        run(&["x509", "-in", &cert, "-outform", "DER", "-out", &der]);
        let pk8 = format!("{name}.pk8.tmp");
        let pk8pem = format!("{name}.pk8pem.tmp");
        run(&[
            "pkcs8", "-topk8", "-nocrypt", "-in", &key, "-outform", "DER", "-out", &pk8,
        ]);
        run(&["pkcs8", "-topk8", "-nocrypt", "-in", &key, "-out", &pk8pem]);
    }
    let read = |name: &str| fs::read_to_string(dir.join(name)).unwrap();
    Certificates {
        ca_pem: read("ca.pem.tmp"),
        server_cert: CertificateDer::from(fs::read(dir.join("server.der.tmp")).unwrap()),
        server_key: PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
            fs::read(dir.join("server.pk8.tmp")).unwrap(),
        )),
        client_cert_pem: read("client.pem.tmp"),
        client_key_pem: read("client.pk8pem.tmp"),
        client_cert_der: fs::read(dir.join("client.der.tmp")).unwrap(),
    }
}

/// Accepts any client certificate and records nothing: the server records the
/// one presented after the handshake.
#[derive(Debug)]
struct AnyClient(Arc<rustls::crypto::CryptoProvider>);

impl ClientCertVerifier for AnyClient {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }

    fn verify_client_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _now: UnixTime,
    ) -> Result<ClientCertVerified, rustls::Error> {
        Ok(ClientCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }

    fn client_auth_mandatory(&self) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// The server

/// How the server speaks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tls {
    None,
    /// TLS with the server certificate of [`Certificates`].
    Server,
    /// The same, asking for a client certificate and recording it.
    ClientAuth,
}

/// One request as the server got it.
#[derive(Clone, Debug)]
pub struct Recorded {
    pub method: String,
    pub path: String,
    pub query: Option<String>,
    /// Lower-case names, in the order received.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// The DER of the client certificate presented, if any.
    pub client_cert: Option<Vec<u8>>,
}

impl Recorded {
    pub fn header(&self, name: &str) -> Option<&str> {
        let name = name.to_ascii_lowercase();
        self.headers
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.as_str())
    }
}

/// A streamed answer: its chunks go to every request of its route open at the
/// time; `end` ends them all.
#[derive(Clone)]
pub struct Stream {
    sender: broadcast::Sender<StreamEvent>,
    opened: Arc<AtomicUsize>,
    active: Arc<AtomicUsize>,
}

#[derive(Clone, Debug)]
enum StreamEvent {
    Chunk(Vec<u8>),
    End,
    Drop,
}

impl Stream {
    fn new() -> Self {
        Self {
            sender: broadcast::channel(4096).0,
            opened: Arc::default(),
            active: Arc::default(),
        }
    }

    pub fn send(&self, chunk: impl Into<Vec<u8>>) {
        let _ = self.sender.send(StreamEvent::Chunk(chunk.into()));
    }

    /// Ends the body of every open request normally.
    pub fn end(&self) {
        let _ = self.sender.send(StreamEvent::End);
    }

    /// Cuts the connection of every open request without ending the body.
    pub fn cut(&self) {
        let _ = self.sender.send(StreamEvent::Drop);
    }

    /// How many requests of this route have received its head so far.
    pub fn opened(&self) -> usize {
        self.opened.load(Ordering::SeqCst)
    }

    /// How many requests of this route stream now.
    pub fn active(&self) -> usize {
        self.active.load(Ordering::SeqCst)
    }

    /// Waits until at most `count` requests of this route stream.
    pub async fn wait_active_at_most(&self, count: usize) {
        for _ in 0..500 {
            if self.active() <= count {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!(
            "{} requests still stream, expected at most {count}",
            self.active()
        );
    }

    /// Waits until at least `count` requests have received the head.
    pub async fn wait_opened(&self, count: usize) {
        for _ in 0..500 {
            if self.opened() >= count {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("the stream was opened {} times, not {count}", self.opened());
    }
}

/// What the server answers on a route.
#[derive(Clone)]
pub enum Answer {
    /// A status, extra headers and a body, `Content-Length` set.
    Full {
        status: u16,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    },
    /// A chunked answer whose body the test sends through the [`Stream`].
    Stream {
        status: u16,
        headers: Vec<(String, String)>,
        stream: Stream,
    },
    /// The answer after a delay.
    Delayed(Duration, Box<Answer>),
    /// The connection closed before any head.
    DropBeforeHead,
    /// A head with a `Content-Length` larger than what follows, then the
    /// connection closed.
    DropAfterHead { status: u16, partial: Vec<u8> },
    /// Nothing at all, the connection kept open.
    Hang,
}

impl Answer {
    pub fn json(status: u16, body: Value) -> Self {
        Self::Full {
            status,
            headers: vec![("content-type".into(), "application/json".into())],
            body: body.to_string().into_bytes(),
        }
    }

    pub fn text(status: u16, body: &str) -> Self {
        Self::Full {
            status,
            headers: vec![("content-type".into(), "text/plain".into())],
            body: body.as_bytes().to_vec(),
        }
    }

    /// A Kubernetes `Status` failure.
    pub fn status(code: u16, reason: &str, message: &str) -> Self {
        Self::json(
            code,
            json!({
                "kind": "Status", "apiVersion": "v1", "metadata": {},
                "status": "Failure", "message": message, "reason": reason, "code": code,
            }),
        )
    }

    pub fn with_header(self, name: &str, value: &str) -> Self {
        match self {
            Self::Full {
                status,
                mut headers,
                body,
            } => {
                headers.push((name.to_ascii_lowercase(), value.into()));
                Self::Full {
                    status,
                    headers,
                    body,
                }
            }
            Self::Stream {
                status,
                mut headers,
                stream,
            } => {
                headers.push((name.to_ascii_lowercase(), value.into()));
                Self::Stream {
                    status,
                    headers,
                    stream,
                }
            }
            other => other,
        }
    }
}

#[derive(Default)]
struct State {
    /// Keyed by `<METHOD> <path>`; a list, answered in turn, the last kept.
    routes: HashMap<String, Vec<Answer>>,
    requests: Vec<Recorded>,
}

/// The fake API server.
#[derive(Clone)]
pub struct FakeApi {
    pub port: u16,
    pub tls: Tls,
    pub certificates: Option<Arc<Certificates>>,
    state: Arc<Mutex<State>>,
    open: Arc<AtomicUsize>,
}

trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

impl FakeApi {
    /// Starts a server on `127.0.0.1` on a free port. `dir` keeps the
    /// certificates of a TLS server.
    pub async fn start(tls: Tls, dir: &Path) -> Self {
        let certificates = (tls != Tls::None).then(|| Arc::new(certificates(dir)));
        let acceptor = certificates.as_ref().map(|certs| {
            let provider = Arc::new(rustls::crypto::ring::default_provider());
            let builder = rustls::ServerConfig::builder_with_provider(Arc::clone(&provider))
                .with_safe_default_protocol_versions()
                .unwrap();
            let builder = match tls {
                Tls::ClientAuth => builder.with_client_cert_verifier(Arc::new(AnyClient(provider))),
                _ => builder.with_no_client_auth(),
            };
            let config = builder
                .with_single_cert(
                    vec![certs.server_cert.clone()],
                    certs.server_key.clone_key(),
                )
                .unwrap();
            TlsAcceptor::from(Arc::new(config))
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let api = Self {
            port,
            tls,
            certificates,
            state: Arc::default(),
            open: Arc::default(),
        };
        let serving = api.clone();
        tokio::spawn(async move {
            loop {
                let Ok((tcp, _)) = listener.accept().await else {
                    return;
                };
                let api = serving.clone();
                let acceptor = acceptor.clone();
                tokio::spawn(async move {
                    api.open.fetch_add(1, Ordering::SeqCst);
                    let (stream, client_cert): (Box<dyn Io>, _) = match acceptor {
                        Some(acceptor) => match acceptor.accept(tcp).await {
                            Ok(stream) => {
                                let cert = stream
                                    .get_ref()
                                    .1
                                    .peer_certificates()
                                    .and_then(|certs| certs.first())
                                    .map(|cert| cert.to_vec());
                                (Box::new(stream), cert)
                            }
                            Err(_) => {
                                api.open.fetch_sub(1, Ordering::SeqCst);
                                return;
                            }
                        },
                        None => (Box::new(tcp), None),
                    };
                    api.serve(stream, client_cert).await;
                    api.open.fetch_sub(1, Ordering::SeqCst);
                });
            }
        });
        api
    }

    /// `http://127.0.0.1:<port>` or `https://…`.
    pub fn url(&self) -> String {
        let scheme = if self.tls == Tls::None {
            "http"
        } else {
            "https"
        };
        format!("{scheme}://127.0.0.1:{}", self.port)
    }

    /// Answers `method path` (the path without its query) with `answer`; a
    /// second call for the same route queues another answer, the last one
    /// being repeated.
    pub fn answer(&self, method: &str, path: &str, answer: Answer) {
        self.state
            .lock()
            .unwrap()
            .routes
            .entry(format!("{method} {path}"))
            .or_default()
            .push(answer);
    }

    /// Replaces the answers of a route.
    pub fn set(&self, method: &str, path: &str, answer: Answer) {
        self.state
            .lock()
            .unwrap()
            .routes
            .insert(format!("{method} {path}"), vec![answer]);
    }

    /// A streamed answer of status 200 on `GET path`, returned to send into.
    pub fn stream(&self, path: &str) -> Stream {
        let stream = Stream::new();
        self.set(
            "GET",
            path,
            Answer::Stream {
                status: 200,
                headers: vec![("content-type".into(), "application/json".into())],
                stream: stream.clone(),
            },
        );
        stream
    }

    /// The answers a reachable cluster gives to a connection: `/version`, the
    /// two access reviews, the namespaces, the API resources of core `v1` and
    /// of one group, and the rules review of each namespace.
    pub fn serve_a_cluster(&self) {
        self.set(
            "GET",
            "/version",
            Answer::json(
                200,
                json!({"gitVersion": "v1.37.0", "major": "1", "minor": "37"}),
            ),
        );
        self.set(
            "POST",
            "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews",
            Answer::json(201, json!({"status": {"allowed": true}})),
        );
        self.set(
            "GET",
            "/api/v1/namespaces",
            Answer::json(
                200,
                json!({"kind": "NamespaceList", "metadata": {"resourceVersion": "1"},
                       "items": [{"metadata": {"name": "default", "uid": "uid-default"}},
                                 {"metadata": {"name": "kube-system", "uid": "uid-system"}}]}),
            ),
        );
        self.set(
            "GET",
            "/api",
            Answer::json(200, json!({"versions": ["v1"]})),
        );
        self.set(
            "GET",
            "/apis",
            Answer::json(
                200,
                json!({"groups": [{"name": "apps", "versions": [{"groupVersion": "apps/v1", "version": "v1"}]}]}),
            ),
        );
        self.set(
            "GET",
            "/api/v1",
            Answer::json(
                200,
                json!({"resources": [
                    {"name": "pods", "kind": "Pod", "namespaced": true},
                    {"name": "pods/log", "kind": "Pod", "namespaced": true},
                    {"name": "configmaps", "kind": "ConfigMap", "namespaced": true},
                    {"name": "namespaces", "kind": "Namespace", "namespaced": false},
                ]}),
            ),
        );
        self.set(
            "GET",
            "/apis/apps/v1",
            Answer::json(
                200,
                json!({"resources": [{"name": "deployments", "kind": "Deployment", "namespaced": true}]}),
            ),
        );
        self.set(
            "POST",
            "/apis/authorization.k8s.io/v1/selfsubjectrulesreviews",
            Answer::json(
                201,
                json!({"status": {"incomplete": false, "resourceRules": [
                    {"verbs": ["*"], "apiGroups": ["*"], "resources": ["*"]}
                ]}}),
            ),
        );
    }

    pub fn requests(&self) -> Vec<Recorded> {
        self.state.lock().unwrap().requests.clone()
    }

    /// The requests of one path, any method.
    pub fn requests_of(&self, path: &str) -> Vec<Recorded> {
        self.requests()
            .into_iter()
            .filter(|request| request.path == path)
            .collect()
    }

    pub fn clear_requests(&self) {
        self.state.lock().unwrap().requests.clear();
    }

    /// The connections open now.
    pub fn open_connections(&self) -> usize {
        self.open.load(Ordering::SeqCst)
    }

    /// Waits until at most `count` connections are open.
    pub async fn wait_open_at_most(&self, count: usize) {
        for _ in 0..500 {
            if self.open_connections() <= count {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!(
            "{} connections still open, expected at most {count}",
            self.open_connections()
        );
    }

    fn next_answer(&self, method: &str, path: &str) -> Option<Answer> {
        let mut state = self.state.lock().unwrap();
        let answers = state.routes.get_mut(&format!("{method} {path}"))?;
        if answers.len() > 1 {
            Some(answers.remove(0))
        } else {
            answers.first().cloned()
        }
    }

    async fn serve(&self, mut stream: Box<dyn Io>, client_cert: Option<Vec<u8>>) {
        loop {
            let Some(head) = read_head(&mut stream).await else {
                return;
            };
            let mut lines = head.split("\r\n");
            let request_line = lines.next().unwrap_or_default();
            let mut parts = request_line.split(' ');
            let method = parts.next().unwrap_or_default().to_string();
            let target = parts.next().unwrap_or_default().to_string();
            let headers: Vec<(String, String)> = lines
                .filter(|line| !line.is_empty())
                .filter_map(|line| line.split_once(':'))
                .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
                .collect();
            let find = |name: &str| {
                headers
                    .iter()
                    .find(|(key, _)| key == name)
                    .map(|(_, value)| value.clone())
            };
            let body = if let Some(length) = find("content-length") {
                let mut body = vec![0; length.parse().unwrap_or(0)];
                if stream.read_exact(&mut body).await.is_err() {
                    return;
                }
                body
            } else if find("transfer-encoding").is_some_and(|value| value.contains("chunked")) {
                match read_chunked(&mut stream).await {
                    Some(body) => body,
                    None => return,
                }
            } else {
                Vec::new()
            };
            let (path, query) = match target.split_once('?') {
                Some((path, query)) => (path.to_string(), Some(query.to_string())),
                None => (target.clone(), None),
            };
            self.state.lock().unwrap().requests.push(Recorded {
                method: method.clone(),
                path: path.clone(),
                query,
                headers,
                body,
                client_cert: client_cert.clone(),
            });
            let answer = self.next_answer(&method, &path).unwrap_or_else(|| {
                Answer::status(
                    404,
                    "NotFound",
                    "the server could not find the requested resource",
                )
            });
            if !self.respond(&mut stream, answer).await {
                return;
            }
        }
    }

    /// Writes one answer; false when the connection is to close.
    async fn respond(&self, stream: &mut Box<dyn Io>, answer: Answer) -> bool {
        match answer {
            Answer::Full {
                status,
                headers,
                body,
            } => {
                let mut head = format!("HTTP/1.1 {status} {}\r\n", reason(status));
                for (name, value) in headers {
                    head.push_str(&format!("{name}: {value}\r\n"));
                }
                head.push_str(&format!(
                    "content-length: {}\r\ncache-control: no-cache, private\r\n\r\n",
                    body.len()
                ));
                if stream.write_all(head.as_bytes()).await.is_err()
                    || stream.write_all(&body).await.is_err()
                {
                    return false;
                }
                stream.flush().await.is_ok()
            }
            Answer::Stream {
                status,
                headers,
                stream: source,
            } => {
                let mut events = source.sender.subscribe();
                let mut head = format!("HTTP/1.1 {status} {}\r\n", reason(status));
                for (name, value) in headers {
                    head.push_str(&format!("{name}: {value}\r\n"));
                }
                head.push_str(
                    "transfer-encoding: chunked\r\ncache-control: no-cache, private\r\n\r\n",
                );
                if stream.write_all(head.as_bytes()).await.is_err() || stream.flush().await.is_err()
                {
                    return false;
                }
                source.opened.fetch_add(1, Ordering::SeqCst);
                source.active.fetch_add(1, Ordering::SeqCst);
                let active = Arc::clone(&source.active);
                let _streaming = scopeguard(move || {
                    active.fetch_sub(1, Ordering::SeqCst);
                });
                let mut probe = [0u8; 1];
                loop {
                    tokio::select! {
                        event = events.recv() => match event {
                            Ok(StreamEvent::Chunk(chunk)) => {
                                let framed = [
                                    format!("{:x}\r\n", chunk.len()).into_bytes(),
                                    chunk,
                                    b"\r\n".to_vec(),
                                ]
                                .concat();
                                if stream.write_all(&framed).await.is_err() || stream.flush().await.is_err() {
                                    return false;
                                }
                            }
                            Ok(StreamEvent::End) => {
                                let _ = stream.write_all(b"0\r\n\r\n").await;
                                let _ = stream.flush().await;
                                return false;
                            }
                            Ok(StreamEvent::Drop) | Err(_) => return false,
                        },
                        // The client closed its side: the request is over.
                        read = stream.read(&mut probe) => {
                            if matches!(read, Ok(0) | Err(_)) {
                                return false;
                            }
                        }
                    }
                }
            }
            Answer::Delayed(delay, answer) => {
                tokio::time::sleep(delay).await;
                Box::pin(self.respond(stream, *answer)).await
            }
            Answer::DropBeforeHead => false,
            Answer::DropAfterHead { status, partial } => {
                let head = format!(
                    "HTTP/1.1 {status} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n",
                    reason(status),
                    partial.len() + 1000
                );
                let _ = stream.write_all(head.as_bytes()).await;
                let _ = stream.write_all(&partial).await;
                let _ = stream.flush().await;
                false
            }
            Answer::Hang => {
                let mut probe = [0u8; 1];
                let _ = stream.read(&mut probe).await;
                false
            }
        }
    }
}

/// Runs `f` when dropped.
struct Guard<F: FnMut()>(F);

impl<F: FnMut()> Drop for Guard<F> {
    fn drop(&mut self) {
        (self.0)();
    }
}

fn scopeguard<F: FnMut()>(f: F) -> Guard<F> {
    Guard(f)
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        301 => "Moved Permanently",
        302 => "Found",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        410 => "Gone",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Status",
    }
}

async fn read_head(stream: &mut (impl AsyncRead + Unpin)) -> Option<String> {
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        match stream.read_u8().await {
            Ok(byte) => head.push(byte),
            Err(_) => return None,
        }
    }
    Some(String::from_utf8_lossy(&head).into_owned())
}

async fn read_chunked(stream: &mut (impl AsyncRead + Unpin)) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    loop {
        let mut line = Vec::new();
        while !line.ends_with(b"\r\n") {
            line.push(stream.read_u8().await.ok()?);
        }
        let size = usize::from_str_radix(String::from_utf8_lossy(&line).trim(), 16).ok()?;
        let mut chunk = vec![0; size + 2];
        stream.read_exact(&mut chunk).await.ok()?;
        if size == 0 {
            return Some(body);
        }
        body.extend_from_slice(&chunk[..size]);
    }
}

// ---------------------------------------------------------------------------
// A CONNECT proxy

/// An HTTP proxy that opens the tunnels it is asked for and records each
/// `CONNECT` target.
#[derive(Clone)]
pub struct ConnectProxy {
    pub port: u16,
    targets: Arc<Mutex<Vec<String>>>,
}

impl ConnectProxy {
    pub async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let targets: Arc<Mutex<Vec<String>>> = Arc::default();
        let recording = Arc::clone(&targets);
        tokio::spawn(async move {
            loop {
                let Ok((mut client, _)) = listener.accept().await else {
                    return;
                };
                let recording = Arc::clone(&recording);
                tokio::spawn(async move {
                    let Some(head) = read_head(&mut client).await else {
                        return;
                    };
                    let target = head
                        .split_whitespace()
                        .nth(1)
                        .unwrap_or_default()
                        .to_string();
                    recording.lock().unwrap().push(target.clone());
                    // `fake-api.test` is the fake server for a client that
                    // would not send a loopback address through a proxy.
                    let upstream_target = target.replace("fake-api.test", "127.0.0.1");
                    let Ok(mut upstream) = tokio::net::TcpStream::connect(&upstream_target).await
                    else {
                        let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n").await;
                        return;
                    };
                    if client
                        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                        .await
                        .is_err()
                    {
                        return;
                    }
                    let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
                });
            }
        });
        Self { port, targets }
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// The `CONNECT` targets asked so far.
    pub fn targets(&self) -> Vec<String> {
        self.targets.lock().unwrap().clone()
    }
}

// ---------------------------------------------------------------------------
// Kubeconfig files

/// The placeholder credentials the kubeconfig files hold; every test of the
/// area searches what the core sends for them (SC-009).
pub const TOKEN: &str = "placeholder-token-0f3b9c";
pub const FILE_TOKEN: &str = "placeholder-file-token-7a21d4";
/// A JWT whose `exp` is in 2100, as kube's OIDC provider reads it, its
/// subject the placeholder.
pub const ID_TOKEN: &str = "eyJhbGciOiJub25lIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6InBsYWNlaG9sZGVyLWlkLXRva2VuLTU1ZThhYSJ9.c2ln";
pub const PASSWORD: &str = "placeholder-password-c19e02";
pub const EXEC_TOKEN: &str = "placeholder-exec-token-93b7f1";

/// The user of a context.
#[derive(Clone, Debug)]
pub enum User {
    None,
    Token(String),
    TokenFile(PathBuf),
    Basic {
        username: String,
        password: String,
    },
    Oidc {
        id_token: String,
    },
    Impersonate {
        token: String,
        user: String,
        groups: Vec<String>,
    },
    ClientCert,
    Exec(Exec),
}

/// An `exec` user.
#[derive(Clone, Debug)]
pub struct Exec {
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub api_version: String,
    pub interactive_mode: Option<String>,
    pub provide_cluster_info: bool,
}

impl Exec {
    pub fn new(command: impl Into<String>) -> Self {
        Self {
            command: command.into(),
            args: Vec::new(),
            env: Vec::new(),
            api_version: "client.authentication.k8s.io/v1".into(),
            interactive_mode: Some("Never".into()),
            provide_cluster_info: false,
        }
    }
}

/// One context of a kubeconfig file.
#[derive(Clone, Debug)]
pub struct Context {
    pub name: String,
    pub server: String,
    pub user: User,
    pub namespace: Option<String>,
    pub proxy_url: Option<String>,
    /// Put the CA of the fake server in the cluster entry.
    pub trust_ca: bool,
}

impl Context {
    pub fn new(name: &str, api: &FakeApi, user: User) -> Self {
        Self {
            name: name.into(),
            server: api.url(),
            user,
            namespace: None,
            proxy_url: None,
            trust_ca: api.tls != Tls::None,
        }
    }
}

/// Writes `file` holding `contexts`, the first one current, as JSON, which is
/// YAML. `api` gives the CA and the client certificate.
pub fn write_kubeconfig(file: &Path, api: Option<&FakeApi>, contexts: &[Context]) {
    let certs = api.and_then(|api| api.certificates.clone());
    let clusters: Vec<Value> = contexts
        .iter()
        .map(|context| {
            let mut cluster = json!({"server": context.server});
            if context.trust_ca {
                let ca = &certs.as_ref().expect("a TLS server").ca_pem;
                cluster["certificate-authority-data"] = json!(base64(ca.as_bytes()));
            }
            if let Some(proxy) = &context.proxy_url {
                cluster["proxy-url"] = json!(proxy);
            }
            json!({"name": format!("{}-cluster", context.name), "cluster": cluster})
        })
        .collect();
    let users: Vec<Value> = contexts
        .iter()
        .map(|context| {
            let user = match &context.user {
                User::None => json!({}),
                User::Token(token) => json!({"token": token}),
                User::TokenFile(path) => json!({"tokenFile": path}),
                User::Basic { username, password } => {
                    json!({"username": username, "password": password})
                }
                User::Oidc { id_token } => json!({"auth-provider": {
                    "name": "oidc",
                    "config": {"id-token": id_token, "client-id": "freelens", "idp-issuer-url": "https://127.0.0.1:1"},
                }}),
                User::Impersonate {
                    token,
                    user,
                    groups,
                } => json!({"token": token, "as": user, "as-groups": groups}),
                User::ClientCert => {
                    let certs = certs.as_ref().expect("a TLS server");
                    json!({
                        "client-certificate-data": base64(certs.client_cert_pem.as_bytes()),
                        "client-key-data": base64(certs.client_key_pem.as_bytes()),
                    })
                }
                User::Exec(exec) => {
                    let mut value = json!({
                        "apiVersion": exec.api_version,
                        "command": exec.command,
                        "args": exec.args,
                        "env": exec.env.iter().map(|(name, value)| json!({"name": name, "value": value})).collect::<Vec<_>>(),
                        "provideClusterInfo": exec.provide_cluster_info,
                    });
                    if let Some(mode) = &exec.interactive_mode {
                        value["interactiveMode"] = json!(mode);
                    }
                    json!({"exec": value})
                }
            };
            json!({"name": format!("{}-user", context.name), "user": user})
        })
        .collect();
    let named: Vec<Value> = contexts
        .iter()
        .map(|context| {
            let mut entry = json!({
                "cluster": format!("{}-cluster", context.name),
                "user": format!("{}-user", context.name),
            });
            if let Some(namespace) = &context.namespace {
                entry["namespace"] = json!(namespace);
            }
            json!({"name": context.name, "context": entry})
        })
        .collect();
    let config = json!({
        "apiVersion": "v1",
        "kind": "Config",
        "clusters": clusters,
        "users": users,
        "contexts": named,
        "current-context": contexts.first().map(|context| context.name.clone()),
    });
    fs::write(file, serde_json::to_string_pretty(&config).unwrap()).unwrap();
}

/// Standard base64 with padding.
pub fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Credential plugins

/// What a credential plugin script does.
#[derive(Clone, Debug)]
pub enum Plugin {
    /// Prints an `ExecCredential` with this token and expiry.
    Token {
        token: String,
        expires: Option<String>,
    },
    /// Prints an `ExecCredential` with the client certificate of `api`.
    ClientCert,
    /// Writes `message` to stderr and exits with `code`.
    Fail { code: i32, message: String },
    /// Sleeps, then prints a token.
    Sleep { seconds: u64, token: String },
}

/// Writes an executable plugin script `dir/name`. Each run appends a line to
/// `dir/name.runs` and writes its environment, NUL separated, to
/// `dir/name.env.<n>`.
pub fn write_plugin(dir: &Path, name: &str, plugin: &Plugin, api: Option<&FakeApi>) -> PathBuf {
    let path = dir.join(name);
    let record = format!(
        "echo run >> '{runs}'\nN=$(wc -l < '{runs}' | tr -d ' ')\n/usr/bin/env -0 > '{env}'.\"$N\"\n",
        runs = dir.join(format!("{name}.runs")).display(),
        env = dir.join(format!("{name}.env")).display(),
    );
    let credential = |status: Value| {
        json!({"apiVersion": "client.authentication.k8s.io/v1", "kind": "ExecCredential", "status": status})
            .to_string()
    };
    let body = match plugin {
        Plugin::Token { token, expires } => {
            let mut status = json!({"token": token});
            if let Some(expires) = expires {
                status["expirationTimestamp"] = json!(expires);
            }
            format!("cat <<'EOF'\n{}\nEOF\n", credential(status))
        }
        Plugin::ClientCert => {
            let certs = api
                .and_then(|api| api.certificates.clone())
                .expect("a TLS server");
            format!(
                "cat <<'EOF'\n{}\nEOF\n",
                credential(json!({
                    "clientCertificateData": certs.client_cert_pem,
                    "clientKeyData": certs.client_key_pem,
                }))
            )
        }
        Plugin::Fail { code, message } => format!("echo '{message}' >&2\nexit {code}\n"),
        Plugin::Sleep { seconds, token } => format!(
            "sleep {seconds}\ncat <<'EOF'\n{}\nEOF\n",
            credential(json!({"token": token}))
        ),
    };
    fs::write(&path, format!("#!/bin/sh\n{record}{body}")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

/// How many times the plugin `dir/name` ran.
pub fn plugin_runs(dir: &Path, name: &str) -> usize {
    fs::read_to_string(dir.join(format!("{name}.runs")))
        .map(|runs| runs.lines().count())
        .unwrap_or(0)
}

/// The environment of the n-th run (from 1) of the plugin `dir/name`.
pub fn plugin_env(dir: &Path, name: &str, run: usize) -> HashMap<String, String> {
    fs::read(dir.join(format!("{name}.env.{run}")))
        .unwrap_or_default()
        .split(|byte| *byte == 0)
        .filter_map(|record| {
            let record = String::from_utf8_lossy(record);
            record
                .split_once('=')
                .map(|(name, value)| (name.to_string(), value.to_string()))
        })
        .collect()
}
