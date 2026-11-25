/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The frame record: which clusters have a frame and which one is visible,
//! shared with every area of the core, and the two channels of cluster-frames
//! (`specs/004-cluster-frames/contracts/frames-api.md`).

use std::collections::{BTreeSet, HashSet};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::messaging::{
    ChannelError, Channels, DuplicateChannel, Log, MessageChannel, QueueEvent, RequestChannel,
    Sender, View,
};

/// `setClusterFrameIdChannel` of `packages/core/src/common/ipc/cluster.ts`.
pub const SET_FRAME_ID: RequestChannel<String, ()> = RequestChannel::new("cluster:set-frame-id");

/// `currentClusterMessageChannel` of
/// `packages/core/src/common/cluster/current-cluster-channel.ts`; `null` when
/// no cluster is visible.
pub const CURRENT_VISIBLE_CLUSTER: MessageChannel<Option<String>> =
    MessageChannel::new("current-visible-cluster");

const REFUSAL: &str = "cluster:set-frame-id is answered only for the sending frame's own cluster";

/// A change of the record, reported to the subscribers in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameEvent {
    Announced(String),
    Forgotten(String),
}

type Listener = Arc<dyn Fn(&FrameEvent) + Send + Sync>;

#[derive(Default)]
struct State {
    frames: BTreeSet<String>,
    visible: Option<String>,
    /// Frames forgotten because their queue closed, recorded again if the same
    /// page polls again (research R11).
    lost: BTreeSet<String>,
}

struct Inner {
    state: Mutex<State>,
    listeners: Mutex<Vec<Listener>>,
    /// The ids of the catalog, the only clusters that can be visible.
    catalog: HashSet<String>,
    sender: Sender,
    log: Log,
}

/// Built once at startup and cloned into every area that needs it.
#[derive(Clone)]
pub struct Frames {
    inner: Arc<Inner>,
}

impl Frames {
    /// Whether `cluster` has a recorded frame.
    pub fn has_frame(&self, cluster: &str) -> bool {
        self.inner.sender.sweep();
        self.state().frames.contains(cluster)
    }

    /// The clusters with a recorded frame.
    pub fn frames(&self) -> Vec<String> {
        self.inner.sender.sweep();
        self.state().frames.iter().cloned().collect()
    }

    /// The cluster the main window last named, if it is in the catalog.
    pub fn visible(&self) -> Option<String> {
        self.inner.sender.sweep();
        self.state().visible.clone()
    }

    /// Forgets the frame of `cluster`, as disconnecting or deleting it does.
    pub fn forget(&self, cluster: &str) {
        self.state().lost.remove(cluster);
        self.forget_with(cluster, "removed");
    }

    /// Calls `listener` with every later `Announced` and `Forgotten`, in
    /// order, outside the record's lock.
    pub fn subscribe(&self, listener: impl Fn(&FrameEvent) + Send + Sync + 'static) {
        self.inner
            .listeners
            .lock()
            .expect("the listeners lock")
            .push(Arc::new(listener));
    }

    /// Sends to the frame of `cluster` alone; dropped if it has no frame.
    pub fn send_to<M: Serialize + 'static>(
        &self,
        cluster: &str,
        channel: MessageChannel<M>,
        message: &M,
    ) {
        if self.has_frame(cluster) {
            self.inner
                .sender
                .send_to(&View::Cluster(cluster.to_string()), channel, message);
        }
    }

    /// Sends to the frame of the visible cluster alone; dropped if no cluster
    /// is visible or the visible one has no frame.
    pub fn send_to_visible<M: Serialize + 'static>(&self, channel: MessageChannel<M>, message: &M) {
        if let Some(cluster) = self.visible() {
            self.send_to(&cluster, channel, message);
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.inner.state.lock().expect("the frames lock")
    }

    fn log(&self, line: &str) {
        (self.inner.log)(line);
    }

    fn emit(&self, events: &[FrameEvent]) {
        if events.is_empty() {
            return;
        }
        let listeners = self
            .inner
            .listeners
            .lock()
            .expect("the listeners lock")
            .clone();
        for event in events {
            for listener in &listeners {
                listener(event);
            }
        }
    }

    fn announce(&self, cluster: &str) {
        let added = {
            let mut state = self.state();
            state.lost.remove(cluster);
            state.frames.insert(cluster.to_string())
        };
        if added {
            self.log(&format!("Frames: cluster {cluster} announced"));
            self.emit(&[FrameEvent::Announced(cluster.to_string())]);
        }
    }

    /// The same page of a frame forgotten for its closed queue polls again.
    fn record_again(&self, cluster: &str) {
        let added = {
            let mut state = self.state();
            state.lost.remove(cluster) && state.frames.insert(cluster.to_string())
        };
        if added {
            self.log(&format!(
                "Frames: cluster {cluster} recorded again: its page polls again"
            ));
            self.emit(&[FrameEvent::Announced(cluster.to_string())]);
        }
    }

    /// Forgets a frame whose queue closed, which its page may still have.
    fn lose(&self, cluster: &str) {
        let removed = {
            let mut state = self.state();
            let removed = state.frames.remove(cluster);
            if removed {
                state.lost.insert(cluster.to_string());
            }
            removed
        };
        if removed {
            self.forgotten(cluster, "its queue closed");
        }
    }

    fn set_visible(&self, cluster: Option<String>) {
        let visible = cluster.filter(|id| self.inner.catalog.contains(id));
        match &visible {
            Some(id) => self.log(&format!("Frames: visible cluster {id}")),
            None => self.log("Frames: no visible cluster"),
        }
        self.state().visible = visible;
    }

    fn forget_with(&self, cluster: &str, reason: &str) {
        let removed = self.state().frames.remove(cluster);
        if removed {
            self.forgotten(cluster, reason);
        }
    }

    fn forgotten(&self, cluster: &str, reason: &str) {
        self.log(&format!("Frames: cluster {cluster} forgotten: {reason}"));
        self.emit(&[FrameEvent::Forgotten(cluster.to_string())]);
    }

    fn forget_all(&self, reason: &str) {
        let forgotten = {
            let mut state = self.state();
            // The frames of the earlier main page are gone with it.
            state.lost.clear();
            std::mem::take(&mut state.frames)
        };
        for cluster in &forgotten {
            self.log(&format!("Frames: cluster {cluster} forgotten: {reason}"));
        }
        let events: Vec<FrameEvent> = forgotten.into_iter().map(FrameEvent::Forgotten).collect();
        self.emit(&events);
    }
}

/// Builds the record, answers the two channels of cluster-frames, and has the
/// record follow the queues: a closed queue forgets its frame, the same page
/// polling again records it again, and a reload of the main window forgets
/// them all (research R5 and R11 of spec 004).
pub fn register(
    channels: &mut Channels,
    catalog: HashSet<String>,
    log: Log,
) -> Result<Frames, DuplicateChannel> {
    let frames = Frames {
        inner: Arc::new(Inner {
            state: Mutex::new(State::default()),
            listeners: Mutex::new(Vec::new()),
            catalog,
            sender: channels.sender(),
            log,
        }),
    };

    let announcing = frames.clone();
    channels.answer(SET_FRAME_ID, move |cluster: String, view: View| {
        let frames = announcing.clone();
        async move {
            match &view {
                View::Cluster(own) if *own == cluster => {
                    frames.announce(&cluster);
                    Ok(())
                }
                _ => {
                    frames.log(&format!(
                        "Frames: refused cluster:set-frame-id from {view} for cluster {cluster}"
                    ));
                    Err(ChannelError::from(REFUSAL))
                }
            }
        }
    })?;

    let naming = frames.clone();
    channels.listen(
        CURRENT_VISIBLE_CLUSTER,
        move |cluster: Option<String>, view| match view {
            View::Main => naming.set_visible(cluster),
            View::Cluster(_) => {
                naming.log(&format!(
                    "Frames: dropped current-visible-cluster from {view}"
                ));
            }
        },
    );

    let following = frames.clone();
    channels.sender().on_queue_event(move |event| match event {
        QueueEvent::Closed(View::Cluster(cluster)) => following.lose(cluster),
        QueueEvent::Reopened(View::Cluster(cluster)) => following.record_again(cluster),
        QueueEvent::Restarted(View::Main) => following.forget_all("the main window reloaded"),
        _ => {}
    });

    Ok(frames)
}
