// ============================================================
// ADDITIONS FOR main.js — paste these into the safeHandle block
// (after the store:setCurrentSubTab handler, around line 3692)
// ============================================================

  // ====== Active main-tab persistence (for refresh navigation fix) ======
  safeHandle("store:getActiveMain", () => {
    try {
      return typeof store.getActiveMain === "function"
        ? store.getActiveMain()
        : store.get("activeMain");
    } catch (err) {
      console.error("store:getActiveMain error", err);
      return null;
    }
  });

  safeHandle("store:setActiveMain", (_e, tab) => {
    try {
      return typeof store.setActiveMain === "function"
        ? store.setActiveMain(tab)
        : store.set("activeMain", tab);
    } catch (err) {
      console.error("store:setActiveMain error", err);
      return null;
    }
  });

  // ====== Delete stored photos (dedicated handler for Settings > Storage) ======
  // This supplements the existing storage:delete-all and storage:cleanup handlers.
  // AdminDashboard calls native.deleteStoredPhotos({ path, userId }) as a fallback.
  safeHandle("storage:delete-stored-photos", async (_e, opts) => {
    try {
      const targetPath = typeof opts === "string" ? opts : opts?.path;
      if (!targetPath) return { ok: false, error: "No path provided" };

      // Safety: only allow deletion inside the app's userData directory
      // or inside a user-configured storagePath
      const resolvedTarget = path.resolve(targetPath);
      const userData = app.getPath("userData");
      const userId = (typeof opts === "object" ? opts?.userId : null) || getUserIdFromStore();

      // Validate the path is within allowed directories
      const allowedRoots = [userData];
      if (userId) {
        const { capturesDir } = getPaths(userId);
        if (capturesDir) allowedRoots.push(path.resolve(capturesDir));
      }

      const isSafe = allowedRoots.some(root => resolvedTarget.startsWith(path.resolve(root)));
      if (!isSafe) {
        console.warn("[storage:delete-stored-photos] blocked path outside allowed roots:", resolvedTarget);
        return { ok: false, error: "Path is outside allowed storage directories" };
      }

      if (!fs.existsSync(resolvedTarget)) {
        return { ok: true, message: "Directory does not exist", deletedCount: 0 };
      }

      let deleted = 0;
      const photoExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.mp4', '.mov', '.avi', '.webm']);

      async function deletePhotos(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await deletePhotos(full);
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (photoExts.has(ext)) {
              try { await fsp.unlink(full); deleted++; } catch { }
            }
          }
        }
      }

      await deletePhotos(resolvedTarget);
      return { ok: true, message: `Deleted ${deleted} photo/video file(s)`, deletedCount: deleted };
    } catch (err) {
      console.error("storage:delete-stored-photos error:", err);
      return { ok: false, error: String(err) };
    }
  });
