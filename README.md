# Data Profiling Manager

A local-first and hostable Streamlit application for profiling CSV, Excel, and Parquet datasets.

## What users can do

- Upload a dataset through a browser interface
- Review basic and advanced profiling results
- Inspect numeric correlations
- Download a formatted Excel profiling report
- Optionally generate a plain-language explanation using their own Gemini API key

The deterministic profile does not require AI. Gemini receives only aggregate profiling metrics, not raw rows or sample values.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
streamlit run app.py
```

## Host on Streamlit Community Cloud

1. Put these files in a public GitHub repository.
2. In Streamlit Community Cloud, create an app from the repository.
3. Set the entry point to `app.py`.
4. Deploy.

No shared Gemini key is required. Each user enters their own API key in a masked field for the current session. This is their Gemini credential, not a password for the app.

## Privacy model

The hosted edition should not be used for confidential, regulated, or highly sensitive datasets. Uploads are processed by the Streamlit server. The application does not intentionally save a cross-user dataset history. For stricter privacy, users should run or package the local edition.

## Main files

- `app.py` — Streamlit interface and Gemini integration
- `ai_helper.py` — aggregate-only Gemini payload and explanation helper
- `data_profiler.py` — deterministic profiling and Excel report generation
- `requirements.txt` — Python dependencies
- `monthly_profiling_agent.py` — optional scheduled email workflow
- `.github/workflows/monthly_profiling.yml` — optional GitHub Actions schedule

## License

MIT License. See [LICENSE](LICENSE).
