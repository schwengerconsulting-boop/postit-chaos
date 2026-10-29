import { h } from "harmaja"

const svg = (children: any, fill = "none") => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill={fill} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        {children}
    </svg>
)

/** Einfache Linien-Icons (24x24, Farbe über currentColor). */
export const ToolIcons = {
    select: svg(<path d="M6 3l12 10.5-5.5.7 3 6.3-2.4 1.1-3-6.4L6 18.5z" />),
    pan: svg(
        <path d="M9 11V5.5a1.5 1.5 0 013 0V10m0-1.5V4.5a1.5 1.5 0 013 0V10m0-3a1.5 1.5 0 013 0v7.5a6.5 6.5 0 01-6.5 6.5H12a6 6 0 01-4.7-2.3L4 14.5a1.6 1.6 0 012.4-2L9 15" />,
    ),
    note: svg(<path d="M4 4h16v10l-6 6H4z M14 20v-6h6" />),
    text: svg(<path d="M5 6V4h14v2M12 4v16M9 20h6" />),
    rect: svg(<rect x="4" y="6" width="16" height="12" rx="1" />),
    ellipse: svg(<ellipse cx="12" cy="12" rx="9" ry="6.5" />),
    line: svg(<path d="M5 19L19 5" />),
    arrow: svg(<path d="M5 19L19 5M10 5h9v9" />),
    pen: svg(<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z M14.5 6.5l3 3" />),
    image: svg(<path d="M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15 9.5h.01" />),
    link: svg(<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />),
    connect: svg(<path d="M5 18c0-8 6-12 14-12M16 3l3 3-3 3" />),
    container: svg(<path d="M4 4h16v16H4z M4 9h16" />),
    undo: svg(<path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" />),
    redo: svg(<path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13" />),
    duplicate: svg(<path d="M8 8h12v12H8z M16 8V4H4v12h4" />),
    trash: svg(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />),
}
