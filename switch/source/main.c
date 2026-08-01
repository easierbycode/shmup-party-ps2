// Sh'M↑ Party — Nintendo Switch homebrew host.
//
// The third host for the same ps2/ game tree: AthenaEnv provides the globals
// on real PS2, src/web/ps2-scene.ts provides them over Phaser in the browser,
// and this app provides them over SDL2 + quickjs-ng on Switch. The game code
// is evaluated unmodified from romfs:/game/.
//
// Dev loop: launch with `nxlink -s switch/shmup-party.nro` (hbmenu in
// netloader mode) — stdout, including JS stack traces, streams back here.
#include <stdio.h>
#include <SDL2/SDL.h>
#include <SDL2/SDL_image.h>

#ifdef __SWITCH__
#include <switch.h>
#endif

#include "js_host.h"

int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
#ifdef __SWITCH__
    romfsInit();
    socketInitializeDefault();
    nxlinkStdio();
#endif
    printf("[host] shmup-party switch host booting\n");

    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO | SDL_INIT_GAMECONTROLLER) != 0) {
        fprintf(stderr, "[host] SDL_Init: %s\n", SDL_GetError());
        return 1;
    }
    IMG_Init(IMG_INIT_PNG);
    if (!screen_init()) return 1;
    // if audio init fails the Sound global is simply absent and the game
    // runs silent — ps2/lib/audio.js probes for it (capability, not error)
    bool audio_ok = sound_init();

    JSRuntime *rt = JS_NewRuntime();
    JS_SetMaxStackSize(rt, 1024 * 1024);
    js_module_init(rt);
    JSContext *ctx = JS_NewContext(rt);

    host_install_screen(ctx);
    host_install_draw(ctx);
    host_install_image(ctx);
    host_install_pads(ctx);
    if (audio_ok) host_install_sound(ctx);
    // no Network/Request on purpose: ps2/lib/leaderboard.js probes and runs
    // OFFLINE; a libcurl implementation can be added later as pure upside

    bool ok = js_eval_path(ctx, HOST_ROOT "prelude.js", false) &&
              js_eval_path(ctx, GAME_ROOT "main.js", true);
    if (!ok) fprintf(stderr, "[host] boot failed — see trace above\n");

    bool quit = !ok;
    while (!quit
#ifdef __SWITCH__
           && appletMainLoop()
#endif
    ) {
        host_pads_pump(&quit);
        screen_begin_frame();
        // a JS exception here is fatal by design: stop cleanly with the
        // trace on nxlink instead of re-running a broken frame forever
        if (screen_has_frame_cb() && !screen_call_frame_cb(ctx)) quit = true;
        JSContext *pctx;
        while (JS_ExecutePendingJob(rt, &pctx) > 0) {}
        screen_end_frame();
    }

    printf("[host] shutting down\n");
    screen_free_frame_cb(ctx);
    host_pads_free_js(ctx);
    host_pads_shutdown();
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    sound_shutdown();
    screen_shutdown();
    IMG_Quit();
    SDL_Quit();
#ifdef __SWITCH__
    socketExit();
    romfsExit();
#endif
    return ok ? 0 : 1;
}
