export function SectionHeading({
  index,
  title,
  description,
  id,
}: {
  index: string;
  title: string;
  description?: string;
  id?: string;
}) {
  return (
    <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="max-w-2xl">
        <div className="mb-3 flex items-center gap-3">
          <span className="ltr text-[11px] font-semibold tracking-[0.25em] text-gold">{index}</span>
          <span aria-hidden="true" className="gold-rule h-px w-10" />
        </div>
        <h2 id={id} className="text-2xl font-semibold leading-9 text-ink sm:text-[1.7rem]">
          {title}
        </h2>
        {description ? <p className="mt-2 text-sm leading-7 text-muted">{description}</p> : null}
      </div>
    </div>
  );
}
