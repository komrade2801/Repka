import type { SVGProps } from "react"

/** Letter R mark on black — Repka / BIOCAD. */
export function RepkaLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <rect width="32" height="32" rx="4" fill="#111111" />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fill="#ffffff"
        fontFamily="Geist Variable, Inter, system-ui, sans-serif"
        fontSize="18"
        fontWeight="500"
        letterSpacing="-0.04em"
      >
        R
      </text>
    </svg>
  )
}
