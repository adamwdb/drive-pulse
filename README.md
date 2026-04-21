# ⚡ Drive Pulse

**Drive Pulse** is a professional-grade, local security audit and health dashboard for your Google Drive. It allows you to analyze hundreds of thousands of files in seconds, identifying security risks, public exposures, and orphaned assets—all while keeping your metadata private on your own machine.

![Drive Pulse Dashboard](https://raw.githubusercontent.com/adamwdb/drive-pulse/main/static/preview.png) *(Preview Placeholder)*

---

## 🚀 Features

- **Dynamic Health Scoring:** A "Safe Ratio" pulse gauge that measures the percentage of your files that are private or explicitly acknowledged.
- **Security Audit Explorer:** A dedicated high-performance page to search and filter through 300k+ files by name, severity, and ownership.
- **Severity Classification:**
  - 🔥 **Critical:** Publicly shared with full **Editor** access.
  - 🌍 **High:** Publicly shared with **View-only** access.
  - 🔑 **Medium:** Shared with email addresses outside your trusted domain.
  - ⏳ **Low:** Shared assets that haven't been touched in over 6 months.
  - ⚠️ **Unorganized:** Orphaned files with no parent folder (visible via `is:unorganized`).
- **Risk Acknowledgment:** Verify known public files (like open-source code) and mark them as safe to improve your local Health Score.
- **Storage Analysis:** Visual distribution of your Drive payload by file type (Videos, Images, Documents).
- **Dual Identity:** Premium Dark and Light modes with an elegant glassmorphism aesthetic.

---

## 🛠️ Local Setup & Installation

### 1. Prerequisites
- **Python 3.10+**
- **[uv](https://github.com/astral-sh/uv)** (Recommended for high-performance dependency management)
- A **Google Cloud Project** with the Google Drive API enabled.

### 2. Google API Configuration
To connect to your Drive, you need to create your own OAuth credentials:
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project named `Drive-Pulse`.
3. Enable the **Google Drive API**.
4. Configure the **OAuth Consent Screen**:
   - Set User Type to **External**.
   - Add your own Gmail address under **Test Users** (Required while in Testing mode).
5. Create **Credentials**:
   - Click `+ Create Credentials` > `OAuth client ID`.
   - Select **Desktop App**.
6. Download the JSON file, rename it to **`credentials.json`**, and place it in the project root folder.

### 3. Installation
```bash
# Clone the repository
git clone https://github.com/adamwdb/drive-pulse.git
cd drive-pulse

# Sync dependencies and create virtual environment using uv
uv sync
```

### 4. Running the App
```bash
# Start the FastAPI server
uv run uvicorn src.main:app --reload
```
Once started, visit **http://localhost:8000** in your browser.

---

## 🧭 How to Use

1. **Initial Sync:** Click the **Sync Now** button. A browser tab will open for Google Authentication. Once granted, the app will begin crawling your metadata (only metadata is fetched; your file contents are never downloaded).
2. **Dashboard Review:** Check your **Pulse Health Score**. If it's low, review the **Security Audit Log** below.
3. **Acknowledgment:** 
   - You can mark files you own as safe by clicking the **Review (📋+✓)** icon.
   - Once marked safe, the file will be hidden from your main Health Dashboard to help you focus on remaining risks.
   - You can view and "un-acknowledge" files anytime in the **Audit Explorer**.
   - *Note:* Acknowledgment only works for **My Drive** files because you have direct control over their permissions. Shared files are informational only.
4. **Detailed Search:** Click **View Full Explorer** to search through your entire file list and filter by specific risk levels.

---

## ❓ Troubleshooting

### Token Expired or Authentication Error
If you see a "System Error" or authentication failure:
1. Stop the app (Ctrl+C).
2. Delete the `token.json` file in the project root.
3. Restart the app and click **Sync**. This will trigger a fresh Google login.
*Tip: If your token expires every 7 days, go to your Google Cloud Console and set your App Status to "In Production" instead of "Testing".*

---

## 🔒 Privacy & Security
- **Local Database:** All file metadata is stored in a local SQLite file (`drive_health.db`).
- **Private Sessions:** Your `token.json` and `credentials.json` are excluded from Git to prevent accidental exposure.
- **Read-Only:** The app uses the `drive.metadata.readonly` scope. It cannot delete or modify your actual Google Drive files.

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
