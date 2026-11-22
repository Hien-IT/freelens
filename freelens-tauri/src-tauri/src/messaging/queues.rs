/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! One queue of messages per open view, emptied by long polls
//! (`specs/002-messaging-for-tauri/data-model.md`, Queue).

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::sync::oneshot;
use tokio::time::Instant;

use super::{Log, View};

/// How long a poll waits for a message before it is answered empty.
pub const POLL_HOLD: Duration = Duration::from_secs(25);
/// A queue with no poll for this long is closed: its view is gone or stuck.
pub const IDLE_LIMIT: Duration = Duration::from_secs(60);
/// A queue holding more messages than this is closed.
pub const MESSAGE_LIMIT: usize = 10_000;

/// A message as a poll answers it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Polled {
    pub seq: u64,
    pub channel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

struct Pending {
    id: u64,
    after: u64,
    answer: oneshot::Sender<Vec<Polled>>,
}

struct Queue {
    session: String,
    next_seq: u64,
    messages: VecDeque<Polled>,
    pending: Option<Pending>,
    last_poll: Instant,
}

impl Queue {
    fn new(session: &str, now: Instant) -> Self {
        Self {
            session: session.to_string(),
            next_seq: 1,
            messages: VecDeque::new(),
            pending: None,
            last_poll: now,
        }
    }
}

#[derive(Default)]
struct State {
    queues: HashMap<View, Queue>,
    next_poll: u64,
}

pub struct Queues {
    state: Mutex<State>,
    pub(crate) log: Log,
}

impl Queues {
    pub fn new(log: Log) -> Self {
        Self {
            state: Mutex::new(State::default()),
            log,
        }
    }

    /// Answers a poll of `view` with the messages after `after`, waiting up to
    /// `POLL_HOLD` for one. The first poll opens the queue; a new `session`
    /// starts it afresh, as a reloaded page.
    pub async fn poll(&self, view: View, session: &str, after: u64) -> Vec<Polled> {
        let (id, receiver) = {
            let now = Instant::now();
            let mut state = self.state.lock().expect("the queues lock");
            self.close_idle(&mut state, now);
            state.next_poll += 1;
            let id = state.next_poll;
            let queue = state
                .queues
                .entry(view.clone())
                .or_insert_with(|| Queue::new(session, now));
            if queue.session != session {
                *queue = Queue::new(session, now);
            }
            if let Some(older) = queue.pending.take() {
                let _ = older.answer.send(Vec::new());
            }
            queue.messages.retain(|message| message.seq > after);
            queue.last_poll = now;
            if !queue.messages.is_empty() {
                return queue.messages.iter().cloned().collect();
            }
            let (answer, receiver) = oneshot::channel();
            queue.pending = Some(Pending { id, after, answer });
            (id, receiver)
        };

        match tokio::time::timeout(POLL_HOLD, receiver).await {
            Ok(Ok(messages)) => messages,
            _ => {
                let mut state = self.state.lock().expect("the queues lock");
                if let Some(queue) = state.queues.get_mut(&view)
                    && queue
                        .pending
                        .as_ref()
                        .is_some_and(|pending| pending.id == id)
                {
                    queue.pending = None;
                }
                Vec::new()
            }
        }
    }

    /// Appends a message to every open queue and answers the polls waiting.
    pub fn push(&self, channel: &str, payload: Option<Value>) {
        let now = Instant::now();
        let mut state = self.state.lock().expect("the queues lock");
        self.close_idle(&mut state, now);
        let mut over = Vec::new();

        for (view, queue) in &mut state.queues {
            let seq = queue.next_seq;
            queue.next_seq += 1;
            queue.messages.push_back(Polled {
                seq,
                channel: channel.to_string(),
                payload: payload.clone(),
            });
            if queue.messages.len() > MESSAGE_LIMIT {
                over.push(view.clone());
                continue;
            }
            if let Some(pending) = queue.pending.take() {
                let messages: Vec<Polled> = queue
                    .messages
                    .iter()
                    .filter(|message| message.seq > pending.after)
                    .cloned()
                    .collect();
                // A dropped poll leaves its messages queued for the next one.
                let _ = pending.answer.send(messages);
            }
        }

        for view in over {
            state.queues.remove(&view);
            (self.log)(&format!(
                "Messaging: closed the queue of {view}: over {MESSAGE_LIMIT} messages"
            ));
        }
    }

    fn close_idle(&self, state: &mut State, now: Instant) {
        let idle: Vec<View> = state
            .queues
            .iter()
            .filter(|(_, queue)| {
                queue.pending.is_none() && now.duration_since(queue.last_poll) >= IDLE_LIMIT
            })
            .map(|(view, _)| view.clone())
            .collect();
        for view in idle {
            state.queues.remove(&view);
            (self.log)(&format!(
                "Messaging: closed the queue of {view}: no poll for 60 s"
            ));
        }
    }

    /// Whether `view` has an open queue.
    pub fn is_open(&self, view: &View) -> bool {
        self.state
            .lock()
            .expect("the queues lock")
            .queues
            .contains_key(view)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn queues() -> (Arc<Queues>, Arc<Mutex<Vec<String>>>) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let log_lines = Arc::clone(&lines);
        let queues = Queues::new(Arc::new(move |line| {
            log_lines.lock().unwrap().push(line.to_string());
        }));
        (Arc::new(queues), lines)
    }

    fn seqs(messages: &[Polled]) -> Vec<u64> {
        messages.iter().map(|message| message.seq).collect()
    }

    /// Lets a spawned poll reach its wait.
    async fn settle() {
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn the_first_poll_opens_the_queue_and_waits_25_seconds() {
        let (queues, _) = queues();
        assert!(!queues.is_open(&View::Main));

        let started = Instant::now();
        let messages = queues.poll(View::Main, "s1", 0).await;

        assert!(messages.is_empty());
        assert_eq!(started.elapsed(), POLL_HOLD);
        assert!(queues.is_open(&View::Main));
    }

    #[tokio::test(start_paused = true)]
    async fn a_waiting_poll_is_answered_as_soon_as_a_message_arrives() {
        let (queues, _) = queues();
        let poll = tokio::spawn({
            let queues = Arc::clone(&queues);
            async move { queues.poll(View::Main, "s1", 0).await }
        });
        settle().await;

        queues.push("note", Some(Value::from("a")));
        let messages = poll.await.unwrap();

        assert_eq!(
            messages,
            [Polled {
                seq: 1,
                channel: "note".into(),
                payload: Some(Value::from("a"))
            }]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn messages_up_to_after_are_dropped_as_handled() {
        let (queues, _) = queues();
        queues.poll(View::Main, "s1", 0).await;
        queues.push("note", None);
        queues.push("note", None);
        queues.push("note", None);

        assert_eq!(seqs(&queues.poll(View::Main, "s1", 0).await), [1, 2, 3]);
        assert_eq!(seqs(&queues.poll(View::Main, "s1", 2).await), [3]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_new_session_starts_the_queue_afresh() {
        let (queues, _) = queues();
        queues.poll(View::Main, "s1", 0).await;
        queues.push("note", None);
        queues.push("note", None);

        assert!(queues.poll(View::Main, "s2", 0).await.is_empty());
        queues.push("note", None);
        assert_eq!(seqs(&queues.poll(View::Main, "s2", 0).await), [1]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_newer_poll_answers_the_pending_one_empty() {
        let (queues, _) = queues();
        let older = tokio::spawn({
            let queues = Arc::clone(&queues);
            async move {
                let started = Instant::now();
                (queues.poll(View::Main, "s1", 0).await, started.elapsed())
            }
        });
        settle().await;

        let newer = tokio::spawn({
            let queues = Arc::clone(&queues);
            async move { queues.poll(View::Main, "s1", 0).await }
        });
        let (messages, waited) = older.await.unwrap();

        assert!(messages.is_empty());
        assert!(waited < POLL_HOLD);
        queues.push("note", None);
        assert_eq!(seqs(&newer.await.unwrap()), [1]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_queue_without_a_poll_for_60_seconds_closes() {
        let (queues, lines) = queues();
        queues.poll(View::Main, "s1", 0).await;
        tokio::time::advance(IDLE_LIMIT - POLL_HOLD).await;

        queues.push("note", None);

        assert!(!queues.is_open(&View::Main));
        assert_eq!(
            *lines.lock().unwrap(),
            ["Messaging: closed the queue of main: no poll for 60 s"]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_queue_over_10000_messages_closes() {
        let (queues, lines) = queues();
        queues.poll(View::Main, "s1", 0).await;
        for _ in 0..MESSAGE_LIMIT {
            queues.push("note", None);
        }
        assert!(queues.is_open(&View::Main));

        queues.push("note", None);

        assert!(!queues.is_open(&View::Main));
        assert_eq!(
            *lines.lock().unwrap(),
            ["Messaging: closed the queue of main: over 10000 messages"]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn every_open_view_gets_each_message_once_and_unopened_views_none() {
        let (queues, _) = queues();
        let one = View::Cluster("one".into());
        queues.poll(View::Main, "s1", 0).await;
        queues.poll(one.clone(), "s2", 0).await;

        queues.push("note", None);

        assert_eq!(seqs(&queues.poll(View::Main, "s1", 0).await), [1]);
        assert_eq!(seqs(&queues.poll(one, "s2", 0).await), [1]);
        assert!(!queues.is_open(&View::Cluster("two".into())));
    }
}
