<script lang="ts">
  import Phaser from 'phaser'
  import { Game } from '5velte-ph4ser'
  import Ps2Scene from './web/ps2-scene.ts'

  // Single-scene game: Ps2Scene hosts the AthenaEnv runtime; all flow
  // (title <-> arena, pause, restart) lives inside the PS2 game code.
  let game: Phaser.Game | undefined = $state()

  $effect(() => {
    if (!game) return
    ;(window as unknown as { game: Phaser.Game }).game = game
  })
</script>

<Game
  bind:instance={game}
  width={640}
  height={448}
  backgroundColor="#000000"
  scale={{ mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }}
  render={{ pixelArt: true }}
  scene={[Ps2Scene]}
/>

<style>
  :global(body) {
    -webkit-touch-callout: none;
    -webkit-text-size-adjust: none;
    -webkit-user-select: none;
    background: #000;
    height: 100vh;
    margin: 0;
    overflow: hidden;
    touch-action: none;
  }

  :global(canvas) {
    display: block;
  }
</style>
