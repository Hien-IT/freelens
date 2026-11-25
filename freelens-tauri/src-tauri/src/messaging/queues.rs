/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! One queue of messages per open view, emptied by long polls
//! (`specs/002-messaging-for-tauri/data-model.md`, Queue).

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
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

/// What a closed queue leaves behind for its view.
struct ClosedQueue {
    session: String,
    next_seq: u64,
}

#[derive(Default)]
struct State {
    queues: HashMap<View, Queue>,
    /// The session and next number of each view whose queue closed, so that a
    /// view still open that polls again keeps its numbers growing: its `after`
    /// would drop a new queue's messages numbered from 1.
    closed: HashMap<View, ClosedQueue>,
    next_poll: u64,
}

impl State {
    fn close(&mut self, view: &View) {
        if let Some(queue) = self.queues.remove(view) {
            let closed = ClosedQueue {
                session: queue.session,
                next_seq: queue.next_seq,
            };
            self.closed.insert(view.clone(), closed);
        }
    }
}

/// A change of a queue that other parts of the core follow
/// (`specs/004-cluster-frames/data-model.md`, Queue events).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueueEvent {
    /// The queue closed: no poll and none waiting for 60 seconds, or more
    /// than the message limit.
    Closed(View),
    /// A poll named a new session for an open queue, which started afresh.
    Restarted(View),
}

type Subscriber = Arc<dyn Fn(&QueueEvent) + Send + Sync>;

pub struct Queues {
    state: Mutex<State>,
    subscribers: Mutex<Vec<Subscriber>>,
    pub(crate) log: Log,
}

impl Queues {
    pub fn new(log: Log) -> Self {
        Self {
            state: Mutex::new(State::default()),
            subscribers: Mutex::new(Vec::new()),
            log,
        }
    }

    /// Calls `subscriber` with every later queue event, in order, outside the
    /// lock of the queues, so that it may read them or send.
    pub fn on_event(&self, subscriber: impl Fn(&QueueEvent) + Send + Sync + 'static) {
        self.subscribers
            .lock()
            .expect("the subscribers lock")
            .push(Arc::new(subscriber));
    }

    fn report(&self, events: Vec<QueueEvent>) {
        if events.is_empty() {
            return;
        }
        let subscribers = self
            .subscribers
            .lock()
            .expect("the subscribers lock")
            .clone();
        for event in &events {
            for subscriber in &subscribers {
                subscriber(event);
            }
        }
    }

    /// Answers a poll of `view` with the messages after `after`, waiting up to
    /// `POLL_HOLD` for one. The first poll opens the queue; a new `session`
    /// starts it afresh, as a reloaded page.
    pub async fn poll(&self, view: View, session: &str, after: u64) -> Vec<Polled> {
        let mut events = Vec::new();
        let waiting = {
            let now = Instant::now();
            let mut state = self.state.lock().expect("the queues lock");
            self.close_idle(&mut state, now, &mut events);
            state.next_poll += 1;
            let id = state.next_poll;
            let next_seq = state
                .closed
                .remove(&view)
                .filter(|closed| closed.session == session)
                .map_or(1, |closed| closed.next_seq);
            let queue = state.queues.entry(view.clone()).or_insert_with(|| Queue {
                next_seq,
                ..Queue::new(session, now)
            });
            if queue.session != session {
                *queue = Queue::new(session, now);
                events.push(QueueEvent::Restarted(view.clone()));
            }
            if let Some(older) = queue.pending.take() {
                let _ = older.answer.send(Vec::new());
            }
            queue.messages.retain(|message| message.seq > after);
            queue.last_poll = now;
            if queue.messages.is_empty() {
                let (answer, receiver) = oneshot::channel();
                queue.pending = Some(Pending { id, after, answer });
                Ok((id, receiver))
            } else {
                Err(queue.messages.iter().cloned().collect())
            }
        };
        self.report(events);
        let (id, receiver) = match waiting {
            Ok(waiting) => waiting,
            Err(messages) => return messages,
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
        let mut events = Vec::new();
        {
            let mut state = self.state.lock().expect("the queues lock");
            self.close_idle(&mut state, Instant::now(), &mut events);
            let views: Vec<View> = state.queues.keys().cloned().collect();
            for view in views {
                self.append(&mut state, &view, channel, payload.clone(), &mut events);
            }
        }
        self.report(events);
    }

    /// Appends a message to the queue of `view` alone and answers its poll;
    /// does nothing if `view` has no open queue.
    pub fn push_to(&self, view: &View, channel: &str, payload: Option<Value>) {
        let mut events = Vec::new();
        {
            let mut state = self.state.lock().expect("the queues lock");
            self.close_idle(&mut state, Instant::now(), &mut events);
            self.append(&mut state, view, channel, payload, &mut events);
        }
        self.report(events);
    }

    /// Closes the queues that have been idle too long, as a poll or a send
    /// would, so that their views are known to be gone without either.
    pub fn sweep(&self) {
        let mut events = Vec::new();
        {
            let mut state = self.state.lock().expect("the queues lock");
            self.close_idle(&mut state, Instant::now(), &mut events);
        }
        self.report(events);
    }

    fn append(
        &self,
        state: &mut State,
        view: &View,
        channel: &str,
        payload: Option<Value>,
        events: &mut Vec<QueueEvent>,
    ) {
        let Some(queue) = state.queues.get_mut(view) else {
            return;
        };
        let seq = queue.next_seq;
        queue.next_seq += 1;
        queue.messages.push_back(Polled {
            seq,
            channel: channel.to_string(),
            payload,
        });
        if queue.messages.len() > MESSAGE_LIMIT {
            state.close(view);
            (self.log)(&format!(
                "Messaging: closed the queue of {view}: over {MESSAGE_LIMIT} messages"
            ));
            events.push(QueueEvent::Closed(view.clone()));
            return;
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

    fn close_idle(&self, state: &mut State, now: Instant, events: &mut Vec<QueueEvent>) {
        let idle: Vec<View> = state
            .queues
            .iter()
            .filter(|(_, queue)| {
                // A poll whose request has been dropped waits for nobody.
                let waiting = queue
                    .pending
                    .as_ref()
                    .is_some_and(|pending| !pending.answer.is_closed());
                !waiting && now.duration_since(queue.last_poll) >= IDLE_LIMIT
            })
            .map(|(view, _)| view.clone())
            .collect();
        for view in idle {
            state.close(&view);
            (self.log)(&format!(
                "Messaging: closed the queue of {view}: no poll for 60 s"
            ));
            events.push(QueueEvent::Closed(view));
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

    /// Opens the queue of the main window with session `s1`, has it handle
    /// two messages, then closes it for no poll in 60 seconds.
    async fn closed_after_two_messages(queues: &Arc<Queues>) {
        queues.poll(View::Main, "s1", 0).await;
        queues.push("note", None);
        queues.push("note", None);
        assert_eq!(seqs(&queues.poll(View::Main, "s1", 0).await), [1, 2]);
        tokio::time::advance(IDLE_LIMIT).await;
        queues.sweep();
        assert!(!queues.is_open(&View::Main));
    }

    #[tokio::test(start_paused = true)]
    async fn a_queue_closed_while_its_view_lives_numbers_on_for_the_same_session() {
        let (queues, _) = queues();
        closed_after_two_messages(&queues).await;

        // The view polls again with its session and the last number it handled.
        let poll = tokio::spawn({
            let queues = Arc::clone(&queues);
            async move { queues.poll(View::Main, "s1", 2).await }
        });
        settle().await;
        queues.push("note", None);

        assert_eq!(seqs(&poll.await.unwrap()), [3]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_queue_closed_then_opened_by_a_new_page_load_numbers_from_1() {
        let (queues, _) = queues();
        closed_after_two_messages(&queues).await;

        let poll = tokio::spawn({
            let queues = Arc::clone(&queues);
            async move { queues.poll(View::Main, "s2", 0).await }
        });
        settle().await;
        queues.push("note", None);

        assert_eq!(seqs(&poll.await.unwrap()), [1]);
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

    /// Records every queue event, and checks that each one is reported
    /// outside the lock: the subscriber reads the queues while it runs.
    fn events(queues: &Arc<Queues>) -> Arc<Mutex<Vec<QueueEvent>>> {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let reader = Arc::clone(queues);
        queues.on_event(move |event| {
            let _ = reader.is_open(&View::Main);
            sink.lock().unwrap().push(event.clone());
        });
        events
    }

    #[tokio::test(start_paused = true)]
    async fn an_idle_queue_is_reported_closed_once() {
        let (queues, _) = queues();
        let events = events(&queues);
        queues.poll(View::Main, "s1", 0).await;
        tokio::time::advance(IDLE_LIMIT - POLL_HOLD).await;

        queues.sweep();
        queues.sweep();

        assert_eq!(*events.lock().unwrap(), [QueueEvent::Closed(View::Main)]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_queue_over_the_limit_is_reported_closed_once() {
        let (queues, _) = queues();
        let events = events(&queues);
        queues.poll(View::Main, "s1", 0).await;

        for _ in 0..=MESSAGE_LIMIT {
            queues.push("note", None);
        }
        queues.push("note", None);

        assert_eq!(*events.lock().unwrap(), [QueueEvent::Closed(View::Main)]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_new_session_is_reported_restarted_but_the_first_poll_is_not() {
        let (queues, _) = queues();
        let events = events(&queues);

        queues.poll(View::Main, "s1", 0).await;
        assert!(events.lock().unwrap().is_empty());
        queues.poll(View::Main, "s1", 0).await;
        assert!(events.lock().unwrap().is_empty());

        queues.poll(View::Main, "s2", 0).await;
        assert_eq!(*events.lock().unwrap(), [QueueEvent::Restarted(View::Main)]);
    }

    #[tokio::test(start_paused = true)]
    async fn sweep_closes_an_idle_queue_without_any_poll_or_send() {
        let (queues, lines) = queues();
        queues.poll(View::Main, "s1", 0).await;
        tokio::time::advance(IDLE_LIMIT - POLL_HOLD).await;
        assert!(queues.is_open(&View::Main));

        queues.sweep();

        assert!(!queues.is_open(&View::Main));
        assert_eq!(
            *lines.lock().unwrap(),
            ["Messaging: closed the queue of main: no poll for 60 s"]
        );
    }

    /// A frame goes away while its poll waits: the poll runs to the end of
    /// its hold, and the queue closes 60 seconds after that poll started
    /// (research R5 of spec 004).
    #[tokio::test(start_paused = true)]
    async fn a_queue_whose_last_poll_still_waits_closes_60_seconds_after_it_started() {
        let (queues, _) = queues();
        let events = events(&queues);
        let started = Instant::now();
        let poll = tokio::spawn({
            let queues = Arc::clone(&queues);
            async move { queues.poll(View::Main, "s1", 0).await }
        });
        settle().await;

        tokio::time::advance(POLL_HOLD - Duration::from_secs(1)).await;
        queues.sweep();
        assert!(queues.is_open(&View::Main));

        tokio::time::advance(Duration::from_secs(1)).await;
        assert!(poll.await.unwrap().is_empty());
        tokio::time::advance(IDLE_LIMIT - started.elapsed() - Duration::from_secs(1)).await;
        queues.sweep();
        assert!(queues.is_open(&View::Main));

        tokio::time::advance(Duration::from_secs(1)).await;
        queues.sweep();
        assert!(!queues.is_open(&View::Main));
        assert_eq!(started.elapsed(), IDLE_LIMIT);
        assert_eq!(*events.lock().unwrap(), [QueueEvent::Closed(View::Main)]);
    }

    /// The same, when the task of the poll is dropped instead of running to
    /// the end of its hold: the queue still closes 60 seconds after the poll
    /// started, whatever the web view does with a cancelled request.
    #[tokio::test(start_paused = true)]
    async fn a_queue_whose_last_poll_was_dropped_closes_60_seconds_after_it_started() {
        let (queues, _) = queues();
        let poll = tokio::spawn({
            let queues = Arc::clone(&queues);
            async move { queues.poll(View::Main, "s1", 0).await }
        });
        settle().await;
        poll.abort();
        settle().await;

        tokio::time::advance(IDLE_LIMIT - Duration::from_secs(1)).await;
        queues.sweep();
        assert!(queues.is_open(&View::Main));

        tokio::time::advance(Duration::from_secs(1)).await;
        queues.sweep();
        assert!(!queues.is_open(&View::Main));
    }

    #[tokio::test(start_paused = true)]
    async fn push_to_reaches_one_view_with_its_own_sequence_and_answers_its_poll() {
        let (queues, _) = queues();
        let one = View::Cluster("one".into());
        queues.poll(View::Main, "s1", 0).await;
        queues.poll(one.clone(), "s2", 0).await;
        queues.push("note", None);
        assert!(queues.poll(one.clone(), "s2", 1).await.is_empty());

        let waiting = tokio::spawn({
            let queues = Arc::clone(&queues);
            let one = one.clone();
            async move { queues.poll(one, "s2", 1).await }
        });
        settle().await;
        queues.push_to(&one, "only", Some(Value::from(7)));

        assert_eq!(
            waiting.await.unwrap(),
            [Polled {
                seq: 2,
                channel: "only".into(),
                payload: Some(Value::from(7))
            }]
        );
        assert!(queues.poll(View::Main, "s1", 1).await.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn push_to_a_view_without_a_queue_does_nothing() {
        let (queues, lines) = queues();
        let two = View::Cluster("two".into());

        queues.push_to(&two, "only", None);

        assert!(!queues.is_open(&two));
        assert!(lines.lock().unwrap().is_empty());
    }
}
