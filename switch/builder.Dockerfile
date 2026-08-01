# devkitA64 toolchain + the SDL2 portlibs this project links against.
# Built once locally by scripts/build-switch-nro.mjs (tag: shmup-switch-builder)
# and layered the same way in .github/workflows/switch.yml.
FROM devkitpro/devkita64:latest
RUN dkp-pacman -Sy --noconfirm && \
    dkp-pacman -S --noconfirm --needed \
      switch-sdl2 switch-sdl2_image switch-sdl2_mixer switch-libpng switch-zlib && \
    dkp-pacman -Scc --noconfirm
