export function SystemLog({ messages }: { messages: string[] }) {
  return (
    <div className="px-slab hidden w-64 flex-col gap-2 p-3 md:flex">
      <p className="px-label">Mesa</p>
      <ul
        className="flex max-h-28 flex-col-reverse gap-0.5 overflow-y-auto text-xs"
        style={{ color: "var(--paper-sh)" }}
      >
        {[...messages].reverse().map((message, index) => (
          <li key={`${messages.length - index}-${message}`}>
            {index === 0 && <span className="px-caret" style={{ color: "var(--mark)" }}>▌</span>}
            {message}
          </li>
        ))}
      </ul>
    </div>
  );
}
