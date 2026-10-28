/** Brand lockup: the scrub-track W symbol plus the wordmark. "Track" takes the accent, like the watched part of the symbol. */
export function Logo({ className = 'size-7' }: { className?: string }) {
  return (
    <>
      <img src="/icon.svg" alt="" className={`${className} shrink-0`} />
      <span className="truncate text-[15px] font-semibold tracking-[-0.02em]">
        Watch<span className="text-accent-text">Track</span>
      </span>
    </>
  )
}
