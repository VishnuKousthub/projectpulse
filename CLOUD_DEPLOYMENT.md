# 🚀 Production Cloud & On-Premise Deployment Guide

Deploy **ProjectPulse** to get a **permanent 24/7 public HTTPS domain** with **zero data loss**, persistent storage, and automated GitHub CI/CD deployments.

---

## 🌟 Option 1: Google Cloud Run (100% Free with Persistent Storage)

Google Cloud Run provides **2,000,000 free requests per month**. By mounting a free Google Cloud Storage (GCS) bucket, your tasks, users, and Gantt charts are **permanently saved** across all instance starts, stops, and updates.

### Step 1: Create a Free Storage Bucket in Google Cloud
1. Open the **[Google Cloud Storage Console](https://console.cloud.google.com/storage/browser)**.
2. Click **Create Bucket**.
3. Set Name: `projectpulse-data-<your-company-name>` (e.g., `projectpulse-data-chemtatva`).
4. Location: Select **Region** (choose closest to you, e.g., `us-central1` or `asia-south1`).
5. Storage class: **Standard** (5 GB free storage).
6. Access control: **Uniform**.
7. Click **Create**.

### Step 2: Deploy to Google Cloud Run
1. Go to **[Cloud Run](https://console.cloud.google.com/run)** in Google Cloud Console.
2. Click **Create Service**.
3. Choose **"Continuously deploy from a repository"** and select your GitHub repository: `VishnuKousthub/projectpulse`.
4. Build Type: **Dockerfile**.
5. Service Name: `projectpulse`.
6. Region: Same region as your bucket (e.g., `us-central1`).
7. Authentication: Check **"Allow unauthenticated invocations"** (public access).
8. Expand **"Container, Volumes, Networking, Security"**:
   - Under **Container**: Port = `8000`.
   - Environment Variables:
     - `PROJECT_PULSE_DB` = `/app/data/project_pulse.db`
     - `DOCKER` = `1`
     - `PROD` = `1`
   - Under **Volumes** (Crucial for Data Persistence):
     - Click **Add Volume** → Select **Cloud Storage bucket**.
     - Volume Name: `projectpulse-storage`.
     - Bucket: Select `projectpulse-data-<your-company-name>`.
     - Click **Done**.
   - Under **Volume Mounts**:
     - Select Volume: `projectpulse-storage`.
     - Mount path: `/app/data`.
9. Click **Create**.

🎉 **Your app is now live with enterprise 99.99% SLA and permanent cloud storage!**

---

## ⚡ Option 2: Railway.app (Easiest 1-Click Setup)

Railway is the fastest PaaS host with zero-configuration persistent volume support.

1. Go to **[Railway.app](https://railway.app)** and sign in with GitHub.
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select `VishnuKousthub/projectpulse`.
4. Go to **Settings** → **Networking** → Click **Generate Domain**.
5. (Optional Persistent Volume): Under your service, click **+ Add Volume** → Mount to `/app/data`.
6. Your app is live with permanent HTTPS: `https://projectpulse.up.railway.app`.

---

## 🌿 Option 3: Koyeb.com (100% Free Eco Tier)

1. Sign up at **[Koyeb.com](https://www.koyeb.com)**.
2. Click **Create Service** → Choose **GitHub**.
3. Select `VishnuKousthub/projectpulse`.
4. Set Builder to **Dockerfile** and Port to `8000`.
5. Click **Deploy**. Your app will be live at `https://<your-app>.koyeb.app`.

---

## 🏢 Option 4: On-Premise / Local Server (100% Private LAN)

If deploying to your own company office server or dedicated PC:
1. Double-click `install_autostart_on_boot.bat` on the Windows server, or run `docker compose up -d` on Linux.
2. Open port 8000 in your server's firewall.
3. Access from any device on your office network: `http://<SERVER_IP>:8000`.
