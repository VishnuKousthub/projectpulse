# 🐳 ProjectPulse - Docker Deployment Guide

This guide walks you through deploying **ProjectPulse** as a high-performance, production containerized web application accessible to everyone.

---

## ⚡ Quick Start (1-Command Launch)

### Prerequisites:
Make sure [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac) or [Docker Engine + Docker Compose](https://docs.docker.com/engine/install/) (Linux) is installed.

### Step 1: Start Container with Docker Compose
Open your terminal in the `project_pulse` directory and run:

```bash
docker compose up -d --build
```

That's it! Your application is now running in the background.

---

## 🌐 How Team Members Access the Website:

### 1. From the Host Machine:
Open: **[http://localhost:8000](http://localhost:8000)**

### 2. From Any Computer / Phone on the Same Wi-Fi / Local Network (LAN):
Find the Host IP address (`ipconfig` on Windows or `ip a` / `hostname -I` on Linux):
```
http://<YOUR_SERVER_IP>:8000
```
*(Example: `http://192.168.1.105:8000`)*

### 3. Over the Internet (Production Cloud VM / VPS):
Deploy on any cloud provider (AWS EC2, DigitalOcean Droplet, Azure VM, Google Cloud Compute):
```
http://<PUBLIC_SERVER_IP>:8000
```
*(Or point your custom domain like `https://projects.yourcompany.com` using Nginx/Cloudflare)*.

---

## 🛠️ Management Commands

| Action | Command |
| :--- | :--- |
| **Start / Build in Background** | `docker compose up -d --build` |
| **View Live Server Logs** | `docker compose logs -f` |
| **Check Container Status** | `docker compose ps` |
| **Stop Server** | `docker compose stop` |
| **Restart Server** | `docker compose restart` |
| **Stop & Remove Container** | `docker compose down` |

---

## 💾 Data Persistence (Never Lose Data)
All project data, activities, timelogs, members, and settings are saved to a named Docker volume (`projectpulse_data`). 
* Even if you rebuild the Docker container or upgrade the application, your project data is preserved safely.

---

## 📧 Configuring Outlook / Office 365 in Docker
To enable real Outlook email dispatches:
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Fill in your SMTP email and app password:
   ```env
   SMTP_USER=notifications@yourcompany.com
   SMTP_PASS=your_outlook_app_password
   ```
3. Restart the container:
   ```bash
   docker compose up -d
   ```
