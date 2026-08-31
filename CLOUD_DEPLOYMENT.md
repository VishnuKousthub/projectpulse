# ?? 1-Click Free Cloud Deployment Guide for ProjectPulse

Deploy **ProjectPulse** to the cloud to get a **permanent 24/7 public HTTPS domain** (e.g., `https://your-projectpulse.onrender.com`) that anyone on your team can access from anywhere in the world, with zero downtime.

---

## ?? Option 1: Deploy on Render.com (Recommended - 100% Free)

**Render** is the easiest and most reliable free cloud host for Docker & Python applications.

### Step 1: Push Code to your GitHub Account
1. Open **[GitHub.com](https://github.com)** and create a new repository called `projectpulse` (set it to **Private** or **Public**).
2. Run these 3 commands in your terminal:
   ```bash
   cd C:\Users\srivishnu\.gemini\antigravity\scratch\project_pulse
   git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/projectpulse.git
   git branch -M main
   git push -u origin main
   ```

### Step 2: Deploy on Render
1. Go to **[Render.com](https://render.com)** and sign in with GitHub.
2. Click **New +** ? **Web Service**.
3. Select your `projectpulse` repository.
4. Set the following settings:
   - **Name**: `projectpulse` (or your company name)
   - **Runtime**: `Docker`
   - **Instance Type**: `Free`
5. Click **Create Web Service**.

?? **That is it!** In 2 minutes, Render will build your container and give you a permanent live public URL like:
?? `https://projectpulse-xyz.onrender.com`

---

## ?? Option 2: Deploy on Railway.app

1. Go to **[Railway.app](https://railway.app)** and click **Start a New Project**.
2. Select **Deploy from GitHub repo** and choose `projectpulse`.
3. Railway will auto-detect the `Dockerfile` and deploy it.
4. Under **Settings** ? **Networking**, click **Generate Domain** to get your public URL:
?? `https://projectpulse.up.railway.app`

---

## ?? Option 3: Deploy on Koyeb.com

1. Go to **[Koyeb.com](https://www.koyeb.com)** and create a free account.
2. Click **Create App** ? Select **GitHub**.
3. Choose your repository and select **Dockerfile**.
4. Click **Deploy**. Your app will be live at:
?? `https://<your-app>.koyeb.app`
