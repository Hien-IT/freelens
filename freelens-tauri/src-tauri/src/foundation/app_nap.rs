/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! Keeps macOS from putting the process in App Nap while its windows are
//! hidden (research R5 of `specs/008-main-catalog`). A napped process's
//! timers fire up to seconds late, and the catalog waits on timers between a
//! change of a synced file and its send. The Electron build's framework
//! turns App Nap off, so its catalog keeps its pace in the background.

/// Starts an activity that lasts as long as the process. It keeps the
/// process out of App Nap and lets the system sleep when idle.
#[cfg(target_os = "macos")]
pub fn opt_out() {
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};

    let reason = NSString::from_str("Freelens follows kubeconfig files and clusters");
    let activity = NSProcessInfo::processInfo().beginActivityWithOptions_reason(
        NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
        &reason,
    );
    // Releasing the activity would end it.
    std::mem::forget(activity);
}

#[cfg(not(target_os = "macos"))]
pub fn opt_out() {}
