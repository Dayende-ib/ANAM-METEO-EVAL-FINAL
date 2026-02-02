import { useState } from "react";

export type AccordionItem = {
 icon: string;
 title: string;
 description: string;
};

type AccordionProps = {
 items: AccordionItem[];
};

export function Accordion({ items }: AccordionProps) {
 const [openIndex, setOpenIndex] = useState<number | null>(0);

 return (
 <div className="space-y-4">
  {items.map((item, index) => {
  const isOpen = openIndex === index;
  return (
   <div
   key={item.title}
   className="group rounded-lg bg-[var(--surface)]/50 p-6 shadow-sm ring-1 ring-inset ring-[var(--border)]"
   >
   <button
    type="button"
    onClick={() => setOpenIndex(isOpen ? null : index)}
    className="flex w-full items-center justify-between cursor-pointer"
   >
    <div className="flex items-center gap-4">
    <div className="flex items-center justify-center size-10 rounded-full bg-secondary/10 text-secondary">
     <span className="material-symbols-outlined">{item.icon}</span>
    </div>
    <span className="text-lg font-medium text-ink ">{item.title}</span>
    </div>
    <span
    className={`material-symbols-outlined transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
    >
    expand_more
    </span>
   </button>
   {isOpen && (
    <p className="mt-4 text-muted text-sm leading-relaxed">{item.description}</p>
   )}
   </div>
  );
  })}
 </div>
 );
}

