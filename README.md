# Filebox

Upload files, bulk rename, get public direct links. No login.

## Deploy on Coolify
1. Upload all these files to a GitHub repo (main folder, no subfolders).
2. Coolify -> Projects -> Add Resource -> Public or Private Repository.
3. Pick the repo, set Build Pack to Docker Compose.
4. Open the app -> set the domain on the "app" service.
5. Click Deploy.

Files are saved in the volume "filebox-data" (mounted at /data), so they survive redeploys.

Health check: /health shows "healthy". Also /health.html.
