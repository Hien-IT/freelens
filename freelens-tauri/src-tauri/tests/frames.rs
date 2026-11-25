/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The frame record and the two channels of cluster-frames
//! (`specs/004-cluster-frames/contracts/frames-api.md`), driven through the
//! `/ipc/` routes as the views reach them.

use std::path::Path;
use std::sync::{Arc, Mutex};

use freelens_tauri::catalog::Catalog;
use freelens_tauri::frames::{FrameEvent, Frames};
use freelens_tauri::messaging::queues::IDLE_LIMIT;
use freelens_tauri::messaging::{Log, MessageChannel, Messaging, routes};
use freelens_tauri::options::KubeconfigChoice;
use freelens_tauri::register_core;
use http::{Method, Request, Response, StatusCode, header};
use serde_json::{Value, json};

const MAIN: &str = "freelens-app://renderer.freelens.app";
const PING: MessageChannel<String> = MessageChannel::new("test:ping");

struct Fixture {
    catalog: Catalog,
    messaging: Messaging,
    frames: Frames,
    lines: Arc<Mutex<Vec<String>>>,
    events: Arc<Mutex<Vec<FrameEvent>>>,
}

fn fixture() -> Arc<Fixture> {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&lines);
    let log: Log = Arc::new(move |line| sink.lock().unwrap().push(line.to_string()));
    let file = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/three-contexts.yaml");
    let catalog = Catalog::load(&KubeconfigChoice::File(file), None);
    let core = register_core(false, "0.1.0".into(), &catalog, &log).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_sink = Arc::clone(&events);
    core.frames
        .subscribe(move |event| events_sink.lock().unwrap().push(event.clone()));
    Arc::new(Fixture {
        catalog,
        messaging: core.messaging,
        frames: core.frames,
        lines,
        events,
    })
}

impl Fixture {
    fn id(&self, index: usize) -> String {
        self.catalog.entries[index].id.clone()
    }

    fn host(&self, index: usize) -> String {
        format!("freelens-app://{}.renderer.freelens.app", self.id(index))
    }

    fn frames_lines(&self) -> Vec<String> {
        self.lines
            .lock()
            .unwrap()
            .iter()
            .filter(|line| line.starts_with("Frames: "))
            .cloned()
            .collect()
    }

    fn events(&self) -> Vec<FrameEvent> {
        self.events.lock().unwrap().clone()
    }

    async fn post(&self, host: &str, path: &str, body: Value) -> Response<Vec<u8>> {
        let request = Request::builder()
            .method(Method::POST)
            .uri(format!("{host}{path}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(body.to_string().into_bytes())
            .unwrap();
        routes::handle(request, &self.catalog, &self.messaging).await
    }

    /// Opens the queue of the view of `host`, or polls it again.
    async fn poll(&self, host: &str, session: &str, after: u64) -> Value {
        let response = self
            .post(
                host,
                "/ipc/poll",
                json!({ "session": session, "after": after }),
            )
            .await;
        json_of(&response)["messages"].clone()
    }

    async fn announce(&self, host: &str, cluster: &str) -> Response<Vec<u8>> {
        self.post(
            host,
            "/ipc/request",
            json!({ "channel": "cluster:set-frame-id", "payload": cluster }),
        )
        .await
    }

    async fn name_visible(&self, host: &str, cluster: Value) {
        let response = self
            .post(
                host,
                "/ipc/messages",
                json!({ "messages": [{ "channel": "current-visible-cluster", "payload": cluster }] }),
            )
            .await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }
}

fn json_of(response: &Response<Vec<u8>>) -> Value {
    serde_json::from_slice(response.body()).unwrap()
}

fn channels_of(messages: &Value) -> Vec<String> {
    messages
        .as_array()
        .unwrap()
        .iter()
        .map(|message| message["channel"].as_str().unwrap().to_string())
        .collect()
}

const REFUSAL: &str = "cluster:set-frame-id is answered only for the sending frame's own cluster";

#[tokio::test(start_paused = true)]
async fn a_frame_announcing_its_own_cluster_is_recorded_and_answered_with_no_value() {
    let f = fixture();

    let response = f.announce(&f.host(0), &f.id(0)).await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_of(&response), json!({}));
    assert!(f.frames.has_frame(&f.id(0)));
    assert_eq!(f.frames.frames(), [f.id(0)]);
    assert_eq!(f.events(), [FrameEvent::Announced(f.id(0))]);
    assert_eq!(
        f.frames_lines(),
        [format!("Frames: cluster {} announced", f.id(0))]
    );
}

#[tokio::test(start_paused = true)]
async fn an_announcement_for_another_cluster_or_from_the_main_window_is_refused() {
    let f = fixture();

    let from_other_frame = f.announce(&f.host(1), &f.id(0)).await;
    let from_main = f.announce(MAIN, &f.id(0)).await;

    for response in [&from_other_frame, &from_main] {
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(json_of(response)["error"]["message"], REFUSAL);
    }
    assert!(f.frames.frames().is_empty());
    assert!(f.events().is_empty());
    assert_eq!(
        f.frames_lines(),
        [
            format!(
                "Frames: refused cluster:set-frame-id from cluster {} for cluster {}",
                f.id(1),
                f.id(0)
            ),
            format!(
                "Frames: refused cluster:set-frame-id from main for cluster {}",
                f.id(0)
            ),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn two_announcements_of_one_cluster_record_it_once() {
    let f = fixture();

    f.announce(&f.host(0), &f.id(0)).await;
    f.announce(&f.host(0), &f.id(0)).await;

    assert_eq!(f.frames.frames(), [f.id(0)]);
    assert_eq!(f.events(), [FrameEvent::Announced(f.id(0))]);
}

#[tokio::test(start_paused = true)]
async fn the_main_window_names_the_visible_cluster_or_none() {
    let f = fixture();

    f.name_visible(MAIN, json!(f.id(1))).await;
    assert_eq!(f.frames.visible(), Some(f.id(1)));

    f.name_visible(MAIN, Value::Null).await;
    assert_eq!(f.frames.visible(), None);

    f.name_visible(MAIN, json!(f.id(2))).await;
    f.name_visible(MAIN, json!("not-in-the-catalog")).await;
    assert_eq!(f.frames.visible(), None);

    assert_eq!(
        f.frames_lines(),
        [
            format!("Frames: visible cluster {}", f.id(1)),
            "Frames: no visible cluster".to_string(),
            format!("Frames: visible cluster {}", f.id(2)),
            "Frames: no visible cluster".to_string(),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_cluster_frame_naming_the_visible_cluster_is_dropped() {
    let f = fixture();
    f.name_visible(MAIN, json!(f.id(2))).await;

    f.name_visible(&f.host(0), json!(f.id(0))).await;

    assert_eq!(f.frames.visible(), Some(f.id(2)));
    assert_eq!(
        f.frames_lines(),
        [
            format!("Frames: visible cluster {}", f.id(2)),
            format!(
                "Frames: dropped current-visible-cluster from cluster {}",
                f.id(0)
            ),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_frame_whose_queue_closes_is_forgotten_on_the_next_read() {
    let f = fixture();
    f.poll(&f.host(0), "frame-0", 0).await;
    f.announce(&f.host(0), &f.id(0)).await;
    assert!(f.frames.has_frame(&f.id(0)));

    // The poll above started 25 seconds ago; no sweep runs in the meantime.
    tokio::time::advance(IDLE_LIMIT - std::time::Duration::from_secs(25)).await;

    assert!(!f.frames.has_frame(&f.id(0)));
    assert_eq!(
        f.events(),
        [
            FrameEvent::Announced(f.id(0)),
            FrameEvent::Forgotten(f.id(0))
        ]
    );
    assert_eq!(
        f.frames_lines().last().unwrap(),
        &format!("Frames: cluster {} forgotten: its queue closed", f.id(0))
    );
}

#[tokio::test(start_paused = true)]
async fn a_reload_of_the_main_window_forgets_every_frame() {
    let f = fixture();
    f.poll(MAIN, "main-1", 0).await;
    f.announce(&f.host(0), &f.id(0)).await;
    f.announce(&f.host(1), &f.id(1)).await;

    f.poll(MAIN, "main-2", 0).await;

    assert!(f.frames.frames().is_empty());
    let mut forgotten: Vec<FrameEvent> = f.events().into_iter().skip(2).collect();
    forgotten.sort_by_key(|event| format!("{event:?}"));
    let mut expected = vec![
        FrameEvent::Forgotten(f.id(0)),
        FrameEvent::Forgotten(f.id(1)),
    ];
    expected.sort_by_key(|event| format!("{event:?}"));
    assert_eq!(forgotten, expected);
    let reloaded: Vec<String> = f
        .frames_lines()
        .into_iter()
        .filter(|line| line.ends_with("forgotten: the main window reloaded"))
        .collect();
    assert_eq!(reloaded.len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_reload_of_a_frame_keeps_it_recorded() {
    let f = fixture();
    f.poll(&f.host(0), "frame-0-a", 0).await;
    f.announce(&f.host(0), &f.id(0)).await;

    f.poll(&f.host(0), "frame-0-b", 0).await;

    assert!(f.frames.has_frame(&f.id(0)));
    assert_eq!(f.events(), [FrameEvent::Announced(f.id(0))]);
}

#[tokio::test(start_paused = true)]
async fn forget_removes_a_frame_and_reports_it() {
    let f = fixture();
    f.announce(&f.host(0), &f.id(0)).await;

    f.frames.forget(&f.id(0));
    f.frames.forget(&f.id(0));

    assert!(!f.frames.has_frame(&f.id(0)));
    assert_eq!(
        f.events(),
        [
            FrameEvent::Announced(f.id(0)),
            FrameEvent::Forgotten(f.id(0))
        ]
    );
    assert_eq!(
        f.frames_lines().last().unwrap(),
        &format!("Frames: cluster {} forgotten: removed", f.id(0))
    );
}

#[tokio::test(start_paused = true)]
async fn send_to_reaches_one_frame_of_three_and_nothing_without_a_frame() {
    let f = fixture();
    for index in 0..3 {
        f.poll(&f.host(index), &format!("frame-{index}"), 0).await;
    }
    f.announce(&f.host(0), &f.id(0)).await;
    f.announce(&f.host(1), &f.id(1)).await;

    f.frames.send_to(&f.id(1), PING, &"to one".to_string());
    // The third cluster has an open queue but no recorded frame.
    f.frames.send_to(&f.id(2), PING, &"to nobody".to_string());

    let one = f.poll(&f.host(1), "frame-1", 0).await;
    assert_eq!(channels_of(&one), ["test:ping"]);
    assert_eq!(one[0]["payload"], "to one");
    let (host_0, host_2) = (f.host(0), f.host(2));
    let (zero, two) = tokio::join!(f.poll(&host_0, "frame-0", 0), f.poll(&host_2, "frame-2", 0));
    assert!(channels_of(&zero).is_empty());
    assert!(channels_of(&two).is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_later_frame_of_a_cluster_gets_nothing_sent_to_the_earlier_one() {
    let f = fixture();
    f.poll(&f.host(0), "earlier", 0).await;
    f.announce(&f.host(0), &f.id(0)).await;
    f.frames
        .send_to(&f.id(0), PING, &"to the earlier frame".to_string());

    let later = f.poll(&f.host(0), "later", 0).await;

    assert!(channels_of(&later).is_empty());
    assert!(f.frames.has_frame(&f.id(0)));
}

#[tokio::test(start_paused = true)]
async fn send_to_visible_reaches_the_visible_frame_or_nothing() {
    let f = fixture();
    for index in 0..2 {
        f.poll(&f.host(index), &format!("frame-{index}"), 0).await;
        f.announce(&f.host(index), &f.id(index)).await;
    }

    f.name_visible(MAIN, json!(f.id(1))).await;
    f.frames
        .send_to_visible(PING, &"to the visible one".to_string());
    f.name_visible(MAIN, Value::Null).await;
    f.frames.send_to_visible(PING, &"to nobody".to_string());

    let (host_0, host_1) = (f.host(0), f.host(1));
    let (zero, one) = tokio::join!(f.poll(&host_0, "frame-0", 0), f.poll(&host_1, "frame-1", 0));
    assert!(channels_of(&zero).is_empty());
    assert_eq!(channels_of(&one), ["test:ping"]);
    assert_eq!(one[0]["payload"], "to the visible one");
}
