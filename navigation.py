"""Shared compact application navigation for hosted and local editions."""
from __future__ import annotations

import html
import re
from collections.abc import Sequence

import streamlit as st


SECTION_FOR_PAGE = {
    "Dashboard": "Workspace",
    "Datasets": "Workspace",
    "Profile": "Workspace",
    "Run profiling": "Workspace",
    "Report viewer": "Workspace",
    "History": "Analyze",
    "Compare": "Analyze",
    "Trends": "Analyze",
    "Monitor": "Analyze",
    "AI explanation": "Tools",
    "Scheduling": "Tools",
    "Plugins": "Tools",
    "Settings": "Tools",
}


def _widget_key(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.casefold()).strip("_")
    return f"dpm_nav_{slug or 'page'}"


def render_sidebar_menu(
    pages: Sequence[str],
    current_page: str,
    *,
    caption: str,
    title: str = "Data Profiling Manager",
) -> None:
    """Render a compact, grouped SaaS-style sidebar menu."""
    st.markdown(
        """
        <style>
        section[data-testid="stSidebar"] {
            background: #FAFAFC;
            border-right: 1px solid #E5E7EF;
        }
        section[data-testid="stSidebar"][aria-expanded="true"] {
            width: 15.5rem;
            min-width: 15.5rem;
            max-width: 15.5rem;
        }
        section[data-testid="stSidebar"] > div:first-child {
            padding-top: 1rem;
        }
        section[data-testid="stSidebar"] div[data-testid="stVerticalBlock"] {
            gap: 0.22rem;
        }
        section[data-testid="stSidebar"] div[data-testid="stButton"] {
            margin: 0;
        }
        section[data-testid="stSidebar"] div[data-testid="stButton"] > button {
            width: 100%;
            min-height: 2.25rem;
            justify-content: flex-start;
            text-align: left;
            padding: 0.42rem 0.72rem;
            border-radius: 0.5rem;
            box-shadow: none;
            font-size: 0.88rem;
            line-height: 1.2;
            transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
        }
        section[data-testid="stSidebar"] div[data-testid="stButton"] > button p {
            text-align: left;
            width: 100%;
        }
        section[data-testid="stSidebar"] div[data-testid="stButton"] > button[kind="secondary"] {
            background: transparent !important;
            border: 1px solid transparent !important;
            color: #34374A !important;
            font-weight: 500;
        }
        section[data-testid="stSidebar"] div[data-testid="stButton"] > button[kind="secondary"]:hover {
            background: #F0F1F8 !important;
            border-color: #E2E4EE !important;
            color: #2D2A6E !important;
        }
        section[data-testid="stSidebar"] div[data-testid="stButton"] > button[kind="primary"] {
            background: #EEF0FB !important;
            border: 1px solid #D9DDF4 !important;
            border-left: 3px solid #5D63C7 !important;
            color: #2D2A6E !important;
            font-weight: 700;
            padding-left: 0.62rem;
        }
        section[data-testid="stSidebar"] .dpm-nav-brand {
            display: flex;
            align-items: center;
            gap: 0.68rem;
            margin: 0.1rem 0 1.05rem;
            padding: 0 0.15rem;
        }
        section[data-testid="stSidebar"] .dpm-nav-mark {
            display: grid;
            place-items: center;
            width: 2rem;
            height: 2rem;
            flex: 0 0 2rem;
            border-radius: 0.58rem;
            background: #2D2A6E;
            color: #FFFFFF;
            font-size: 0.72rem;
            font-weight: 800;
            letter-spacing: 0.03em;
        }
        section[data-testid="stSidebar"] .dpm-nav-brand-copy strong {
            display: block;
            color: #202335;
            font-size: 0.9rem;
            line-height: 1.1;
        }
        section[data-testid="stSidebar"] .dpm-nav-brand-copy span {
            display: block;
            margin-top: 0.12rem;
            color: #777C8D;
            font-size: 0.73rem;
            line-height: 1.1;
        }
        section[data-testid="stSidebar"] .dpm-nav-section {
            margin: 0.78rem 0 0.26rem;
            padding: 0 0.68rem;
            color: #8A8E9E;
            font-size: 0.66rem;
            font-weight: 750;
            letter-spacing: 0.09em;
            text-transform: uppercase;
        }
        section[data-testid="stSidebar"] .dpm-nav-caption {
            margin-top: 0.7rem;
            color: #85899A;
            font-size: 0.72rem;
            line-height: 1.45;
        }
        section[data-testid="stSidebar"] hr {
            margin: 0.9rem 0 0.55rem;
            border-color: #E1E3EC;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )

    safe_title = html.escape(title)
    safe_caption = html.escape(caption)
    with st.sidebar:
        st.markdown(
            f"""
            <div class="dpm-nav-brand">
                <div class="dpm-nav-mark">DPM</div>
                <div class="dpm-nav-brand-copy">
                    <strong>{safe_title}</strong>
                    <span>Profile · Monitor · Compare</span>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        previous_section: str | None = None
        for page in pages:
            section = SECTION_FOR_PAGE.get(page, "Menu")
            if section != previous_section:
                st.markdown(f'<div class="dpm-nav-section">{html.escape(section)}</div>', unsafe_allow_html=True)
                previous_section = section

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
        st.markdown(f'<div class="dpm-nav-caption">{safe_caption}</div>', unsafe_allow_html=True)
