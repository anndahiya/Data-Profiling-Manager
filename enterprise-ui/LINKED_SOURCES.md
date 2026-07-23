# Linked local sources

The hosted web app supports three local-file behaviors:

1. **One-time upload** uses a normal browser file input. The browser does not expose the original local path, so the file must be selected again for a later run.
2. **Linked file** stores a user-approved file handle in the app's IndexedDB. A later run reads the current contents of that same file after checking browser permission.
3. **Linked folder** stores a user-approved directory handle. Each run scans supported files in that directory and selects a match using a wildcard pattern plus either latest-modified or highest-filename selection.

Raw rows remain in the browser. File and directory handles are origin-bound browser objects and are not included in JSON workspace backups.

Linked sources require the File System Access API. Chrome and Edge support this flow; browsers without the picker APIs fall back to one-time upload.

A browser tab cannot provide unattended scheduling while it is closed. Scheduled access to local folders, network drives, or databases must use the local profiling agent. The hosted app should store schedule metadata and configuration, while the agent performs the actual read and returns aggregate profiling results.
