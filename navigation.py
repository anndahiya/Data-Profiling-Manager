"""Shared website-style sidebar navigation for hosted and local editions."""
from __future__ import annotations

import re
from collections.abc import Sequence

import streamlit as st


def _widget_key(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.casefold()).strip("_")
    return f"dpm_nav_{slug or 'page'}"


def render_sidebar_menu(
    pages: Sequence[str],
    current_page: str,
    *,
    caption: str,
    title: str = "Navigation",
) -> None:
    """Render full-width menu rows instead of radio/checklist controls."""
    st.markdown(
        """
        <style>
        section[data-testid="stSidebar"] div[data-testid="stButton"] > button {
            width: 100%;
            min-height: 2.55rem;
            justify-content: flex-start;
            text-align: left;
            padding: 0.55rem 0.78rem;
            border-radius: 0.68rem;
            box-shadow: none;
            transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
        }
        section[data-testid="stSidebar"] div[data-testid="stButton"] > button[kind="secondary"] {
            background: transparent !important;
            border: 1px solid transparent !important;
            color: #202335 !important;
            font-weight: 500;
        }
        section[data-testid="stSidebar"] div[data-testid="stButton"] > button[kind="secondary"]:hover {
            background: #E8EAFE !important;
            border-color: #D9DDEA !important;
            color: #2D2A6E !important;
        }
        section[data-testid="stSidebar"] div[data-testid="stButton"] > button[kind="primary"] {
            background: #2D2A6E !important;
            border-color: #2D2A6E !important;
            color: #FFFFFF !important;
            font-weight: 650;
        }
        section[data-testid="stSidebar"] .dpm-nav-title {
            color: #202335;
            font-size: 1rem;
            font-weight: 750;
            margin: 0.15rem 0 0.65rem;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )

    with st.sidebar:
        st.markdown(f'<div class="dpm-nav-title">{title}</div>', unsafe_allow_html=True)
        for page in pages:
            is_active = page == current_page
            clicked = st.button(
                page,
                key=_widget_key(page),
                type="primary" if is_active else "secondary",
                use_container_width=True,
            )
            if clicked and not is_active:
                st.session_state["_requested_page"] = page
                st.rerun()
        st.divider()
        st.caption(caption)
