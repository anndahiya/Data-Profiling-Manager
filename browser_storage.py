"""Browser-local persistence for the public Streamlit app.

The component stores one JSON workspace in the current browser's localStorage.
Only aggregate profiling snapshots and app settings are persisted; raw uploaded
rows and Gemini API keys are not written by this module.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import streamlit as st

_STORAGE_COMPONENT = st.components.v2.component(
    "dpm_browser_storage",
    html="<span aria-hidden='true'></span>",
    js=r"""
    export default function(component) {
      const { data, setStateValue } = component;
      const key = data.storage_key;
      const currentValue = data.current_value ?? "";
      const currentError = data.current_error ?? "";
      const currentReady = data.current_ready === true;
      let stored = "";
      let error = "";

      try {
        if (data.command === "write") {
          window.localStorage.setItem(key, data.value ?? "");
        } else if (data.command === "clear") {
          window.localStorage.removeItem(key);
        }
        stored = window.localStorage.getItem(key) ?? "";
      } catch (err) {
        error = String(err?.message ?? err ?? "Browser storage failed");
      }

      if (stored !== currentValue) {
        setStateValue("value", stored);
      }
      if (error !== currentError) {
        setStateValue("error", error);
      }
      if (!currentReady) {
        setStateValue("ready", true);
      }
    }
    """,
)


@dataclass(frozen=True)
class BrowserStorageResult:
    value: str
    error: str
    ready: bool


def _state_value(state: Any, key: str, default: Any) -> Any:
    """Read a key from Streamlit's dict-like component result safely."""
    if state is None:
        return default
    try:
        return state.get(key, default)
    except (AttributeError, TypeError):
        return getattr(state, key, default)


def browser_storage_value(
    storage_key: str,
    *,
    command: str = "read",
    value: str = "",
    component_key: str = "dpm_browser_history_storage",
) -> BrowserStorageResult:
    """Read, write, or clear the browser localStorage workspace."""
    component_state = st.session_state.get(component_key)
    current_value = _state_value(component_state, "value", "") or ""
    current_error = _state_value(component_state, "error", "") or ""
    current_ready = bool(_state_value(component_state, "ready", False))

    result = _STORAGE_COMPONENT(
        data={
            "storage_key": storage_key,
            "command": command,
            "value": value,
            "current_value": current_value,
            "current_error": current_error,
            "current_ready": current_ready,
        },
        default={
            "value": current_value,
            "error": current_error,
            "ready": current_ready,
        },
        key=component_key,
        height=1,
        on_value_change=lambda: None,
        on_error_change=lambda: None,
        on_ready_change=lambda: None,
    )
    return BrowserStorageResult(
        value=_state_value(result, "value", "") or "",
        error=_state_value(result, "error", "") or "",
        ready=bool(_state_value(result, "ready", False)),
    )
