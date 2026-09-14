// electron-builder afterPack hook: gives the packaged Photuna Booth App.exe the
// Photuna icon and version details.
//
// electron-builder normally does this itself, but only with
// win.signAndEditExecutable enabled, and that first unpacks its winCodeSign tools
// — an archive containing symbolic links that Windows will not create without
// administrator rights or Developer Mode. The build then fails, so that option
// stays off and the exe kept Electron's own icon: in the taskbar, on shortcuts
// and in Task Manager. rcedit (a dev dependency) edits the exe directly instead.

const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const { rcedit } = await import("rcedit");
  const { appInfo, projectDir } = context.packager;
  const exeName = `${appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(projectDir, "assets", "icon.ico");

  await rcedit(exePath, {
    icon: iconPath,
    "file-version": appInfo.version,
    "product-version": appInfo.version,
    "version-string": {
      ProductName: appInfo.productName,
      FileDescription: appInfo.productName,
      CompanyName: "Studio Photuna",
      LegalCopyright: `© ${new Date().getFullYear()} Studio Photuna`,
      OriginalFilename: exeName,
      InternalName: appInfo.productName,
    },
  });

  console.log(`  • set Photuna icon and version details  file=${exeName}`);
};
