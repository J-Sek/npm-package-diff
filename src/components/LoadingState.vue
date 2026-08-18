<script setup lang="ts">
  import { computed } from 'vue'

  const props = defineProps<{
    /** Current stage of the diff (e.g. "fetching", "diffing"). */
    stage?: string
    /** Fine-grained detail line shown beneath the stage. */
    detail?: string
    /** Whether the run is being aborted — recolours to warn and overrides the stage label. */
    aborting?: boolean
    /** Files diffed so far, when the run is in the per-file diff pass. */
    done?: number
    /** Files the preliminary scan found to diff. */
    total?: number
  }>()

  const percent = computed(() => (props.total ? Math.round(100 * (props.done ?? 0) / props.total) : 0))
</script>

<template>
  <div class="loading-state flex flex-col items-center justify-center gap-4 min-h-[400px] text-center">
    <svg
      aria-hidden="true"
      class="transition-colors"
      :class="aborting ? 'text-warning' : 'text-primary'"
      fill="currentColor"
      height="48"
      viewBox="0 0 24 24"
      width="48"
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse cx="12" cy="5" rx="4" ry="4">
        <animate
          id="spinner_jbYs"
          attributeName="cy"
          begin="0;spinner_JZdr.end"
          calcMode="spline"
          dur="0.375s"
          fill="freeze"
          keySplines=".33,0,.66,.33"
          values="5;20"
        />

        <animate
          attributeName="rx"
          begin="spinner_jbYs.end"
          calcMode="spline"
          dur="0.05s"
          keySplines=".33,0,.66,.33;.33,.66,.66,1"
          values="4;4.8;4"
        />

        <animate
          attributeName="ry"
          begin="spinner_jbYs.end"
          calcMode="spline"
          dur="0.05s"
          keySplines=".33,0,.66,.33;.33,.66,.66,1"
          values="4;3;4"
        />

        <animate
          id="spinner_ADF4"
          attributeName="cy"
          begin="spinner_jbYs.end"
          calcMode="spline"
          dur="0.025s"
          keySplines=".33,0,.66,.33"
          values="20;20.5"
        />

        <animate
          id="spinner_JZdr"
          attributeName="cy"
          begin="spinner_ADF4.end"
          calcMode="spline"
          dur="0.4s"
          keySplines=".33,.66,.66,1"
          values="20.5;5"
        />
      </ellipse>
    </svg>

    <div v-if="aborting || stage || detail" class="flex flex-col items-center gap-1 max-w-full">
      <span v-if="aborting" class="font-medium text-warning">Aborting…</span>

      <span v-else-if="stage" class="font-medium capitalize text-on-surface">{{ stage }}</span>

      <span v-if="total" class="text-xs"> {{ done }}/{{ total }} files</span>

      <span v-if="detail" class="opacity-60 max-w-full font-mono text-xs text-on-surface-variant truncate">{{ detail }}</span>

      <div
        v-if="total && !aborting"
        aria-label="Diff progress"
        :aria-valuenow="percent"
        class="rounded-full bg-surface-variant h-1 w-60 mt-2 overflow-hidden"
        role="progressbar"
      >
        <div class="rounded-full bg-primary h-full transition-[width]" :style="{ width: `${percent}%` }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
  .loading-state {
    animation: loading-fade-in 0.4s ease-out;
  }

  @keyframes loading-fade-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-state {
      animation: none;
    }
  }
</style>
