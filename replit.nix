{pkgs}: {
  deps = [
    pkgs.chromium
    pkgs.fontconfig
    pkgs.cairo
    pkgs.pango
    pkgs.xorg.libXext
    pkgs.xorg.libX11
    pkgs.xorg.libxcb
    pkgs.expat
    pkgs.libxkbcommon
    pkgs.mesa
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.alsa-lib
    pkgs.libdrm
    pkgs.gtk3
    pkgs.dbus
    pkgs.cups
    pkgs.atk
    pkgs.nspr
    pkgs.nss
    pkgs.glib
  ];
}
