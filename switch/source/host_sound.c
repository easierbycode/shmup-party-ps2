// Sound over SDL2_mixer. The game asks for assets/sfx/<name>.adp (audsrv
// ADPCM); the staged romfs carries the .wav twins prep-assets.py already
// bakes for the browser, so Sfx() rewrites the extension. 24 mixer channels
// deliberately mirror the PS2's 24 ADPCM voices — Sound.findChannel()'s
// "all busy" backpressure (ps2/lib/audio.js:58) behaves identically.
#include <stdio.h>
#include <string.h>
#include <SDL2/SDL_mixer.h>

#include "js_host.h"

#define CHANNELS 24

typedef struct {
    Mix_Chunk *chunk;
    int volume; // 0-100, AthenaEnv scale
} HostSfx;

static JSClassID sfx_class_id;
static bool sound_up = false;

bool sound_init(void) {
    if (Mix_OpenAudio(48000, MIX_DEFAULT_FORMAT, 2, 1024) != 0) {
        fprintf(stderr, "[sound] Mix_OpenAudio: %s\n", Mix_GetError());
        return false;
    }
    Mix_AllocateChannels(CHANNELS);
    sound_up = true;
    return true;
}

void sound_shutdown(void) {
    if (sound_up) Mix_CloseAudio();
    sound_up = false;
}

static void sfx_finalizer(JSRuntime *rt, JSValue val) {
    (void)rt;
    HostSfx *s = JS_GetOpaque(val, sfx_class_id);
    if (s) {
        if (s->chunk) Mix_FreeChunk(s->chunk);
        free(s);
    }
}

static JSClassDef sfx_class = {
    .class_name = "Sfx",
    .finalizer = sfx_finalizer,
};

static JSValue sfx_get_volume(JSContext *ctx, JSValue this_val) {
    HostSfx *s = JS_GetOpaque2(ctx, this_val, sfx_class_id);
    if (!s) return JS_EXCEPTION;
    return JS_NewInt32(ctx, s->volume);
}

// assigned, not called: initAudio does `s.volume = 35` (ps2/lib/audio.js:35)
static JSValue sfx_set_volume(JSContext *ctx, JSValue this_val, JSValue val) {
    HostSfx *s = JS_GetOpaque2(ctx, this_val, sfx_class_id);
    if (!s) return JS_EXCEPTION;
    int32_t v = 0;
    if (JS_ToInt32(ctx, &v, val)) return JS_EXCEPTION;
    if (v < 0) v = 0;
    if (v > 100) v = 100;
    s->volume = v;
    Mix_VolumeChunk(s->chunk, v * MIX_MAX_VOLUME / 100);
    return JS_UNDEFINED;
}

static JSValue sfx_play(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    (void)argc;
    (void)argv;
    HostSfx *s = JS_GetOpaque2(ctx, this_val, sfx_class_id);
    if (!s) return JS_EXCEPTION;
    Mix_PlayChannel(-1, s->chunk, 0);
    return JS_UNDEFINED;
}

static const JSCFunctionListEntry sfx_proto_funcs[] = {
    JS_CGETSET_DEF("volume", sfx_get_volume, sfx_set_volume),
    JS_CFUNC_DEF("play", 0, sfx_play),
};

static JSValue sound_sfx(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    (void)this_val;
    if (argc < 1) return JS_ThrowTypeError(ctx, "Sound.Sfx(path) expects a path");
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    // assets/sfx/foo.adp -> romfs .wav twin
    char full[512];
    snprintf(full, sizeof(full), GAME_ROOT "%s", path);
    JS_FreeCString(ctx, path);
    size_t n = strlen(full);
    if (n > 4 && !strcmp(full + n - 4, ".adp")) strcpy(full + n - 4, ".wav");

    Mix_Chunk *chunk = Mix_LoadWAV(full);
    if (!chunk)
        return JS_ThrowReferenceError(ctx, "Sfx load failed: %s (%s)", full, Mix_GetError());

    HostSfx *s = calloc(1, sizeof(*s));
    if (!s) {
        Mix_FreeChunk(chunk);
        return JS_ThrowOutOfMemory(ctx);
    }
    s->chunk = chunk;
    s->volume = 100;

    JSValue obj = JS_NewObjectClass(ctx, sfx_class_id);
    if (JS_IsException(obj)) {
        Mix_FreeChunk(chunk);
        free(s);
        return obj;
    }
    JS_SetOpaque(obj, s);
    return obj;
}

static JSValue sound_find_channel(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    (void)this_val;
    (void)argc;
    (void)argv;
    for (int i = 0; i < CHANNELS; i++)
        if (!Mix_Playing(i)) return JS_NewInt32(ctx, i);
    return JS_NewInt32(ctx, -1);
}

void host_install_sound(JSContext *ctx) {
    JSRuntime *rt = JS_GetRuntime(ctx);
    JS_NewClassID(rt, &sfx_class_id);
    JS_NewClass(rt, sfx_class_id, &sfx_class);

    JSValue proto = JS_NewObject(ctx);
    JS_SetPropertyFunctionList(ctx, proto, sfx_proto_funcs,
                               sizeof(sfx_proto_funcs) / sizeof(sfx_proto_funcs[0]));
    JS_SetClassProto(ctx, sfx_class_id, proto);

    JSValue sound = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, sound, "Sfx", JS_NewCFunction(ctx, sound_sfx, "Sfx", 1));
    JS_SetPropertyStr(ctx, sound, "findChannel",
                      JS_NewCFunction(ctx, sound_find_channel, "findChannel", 0));

    JSValue global = JS_GetGlobalObject(ctx);
    JS_SetPropertyStr(ctx, global, "Sound", sound);
    JS_FreeValue(ctx, global);
}
