"""Browser-local persistence for the public Streamlit app.

Uses Streamlit custom components v2 to read/write one JSON data bundle in the
visitor's browser localStorage. No saved profiling history is stored on the
shared Streamlit server.
"""
from __future__ import annotations

from dataclasses import dataclass

import streamlit as st

_STORAGE_COMPONENT = st.components.v2.component(
    "dpm_browser_storage",
    js=r"""
    export default function(component) {
      const { data, setStateValue } = component;
      const key = data.storage_key;
      const current = data.current_value ?? "";
      const currentError = data.current_error ?? "";
      let stored = "";
      let error = "";

      try {
        stored = window.localStorage.getItem(key) ?? "";
        if (data.command === "write") {
          const nextValue = data.value ?? "";
          if (stored !== nextValue) {
            window.localStorage.setItem(key, nextValue);
            stored = nextValue;
          }
        } else if (data.command === "clear") {
          window.localStorage.removeItem(key);
          stored = "";
        }
      } catch (err) {
        error = String(err?.message ?? err ?? "Browser storage failed");
      }

      if (stored !== current) {
        setStateValue("value", stored);
      }
      if (error !== currentError) {
        setStateValue("error", error);
      }
    }
    """,
)


@dataclass(frozen=True)
class BrowserStorageResult:
    value: str
    error: str


def browser_storage_value(
    storage_key: str,
    *,
    command: str = "read",
    value: str = "",
    component_key: str = "dpm_browser_history_storage",
) -> BrowserStorageResult:
    """Read, write, or clear a browser localStorage value."""
    component_state = st.session_state.get(component_key, {})
    if not isinstance(component_state, dict):
        component_state = {}
    current_value = component_state.get("value", "") or ""
    current_error = component_state.get("error", "") or ""
    result = _STORAGE_COMPONENT(
        data={
            "storage_key": storage_key,
            "command": command,
            "value": value,
            "current_value": current_value,
            "current_error": current_error,
        },
        default={"value": current_value, "error": current_error},
        key=component_key,
        on_value_change=lambda: None,
        on_error_change=lambda: None,
    )
    return BrowserStorageResult(value=result.value or "", error=result.error or "")
