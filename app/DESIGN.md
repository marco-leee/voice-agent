# ZenGrid Design System

## Overview

ZenGrid is a calm, grid-perfect design system built around breathability and visual silence. Crafted for minimal portfolio sites and curated content platforms, it uses muted stone tones and generous spacing to let content occupy the center of attention. There are no shadows, no bold colors, no loud contrasts -- only a quiet, warm grid that organizes with precision and recedes with grace.

---

## Colors

- **Stone** (#78716C): Primary text, headings
- **Sage** (#A8A29E): Secondary text, borders
- **Warm White** (#FAF9F6): Background, surfaces
- **Surface Base** (#FAF9F6): App background
- **Success** (#65A30D): Published, live
- **Warning** (#CA8A04): Draft, needs review
- **Error** (#DC2626): Error, removed
- **Info** (#78716C): Informational (uses stone)

## Typography

- **Headline Font**: Raleway
- **Body Font**: DM Sans
- **Mono Font**: Fira Code

- **h1**: Raleway 40px light, 1.15 line height
- **h2**: Raleway 32px light, 1.2 line height
- **h3**: Raleway 24px medium, 1.25 line height
- **h4**: Raleway 18px medium, 1.35 line height
- **body**: DM Sans 15px regular, 1.7 line height
- **small**: DM Sans 13px regular, 1.6 line height
- **tiny**: DM Sans 11px medium, 1.4 line height
- **mono**: Fira Code 13px regular, 1.6 line height

---

## Spacing

Base unit: 12px (spacious)
- **sp-1**: 6px
- **sp-2**: 12px
- **sp-3**: 24px
- **sp-4**: 36px
- **sp-5**: 48px
- **sp-6**: 72px
- **sp-7**: 96px
- **sp-8**: 120px

## Border Radius

- **radius-sm** (2px): Small elements, inline badges
- **radius-md** (4px): Cards, inputs, buttons
- **radius-lg** (6px): Modals
- **radius-none** (0px): Images, full-bleed sections

## Elevation

ZenGrid uses **no shadows**. The system is entirely flat. Visual depth is achieved through background variation and spacing.
- **shadow-none**: None. All elements.
Separation is expressed through border-default borders and background shifts between surface-base and surface-raised.

## Components

### Buttons

All buttons use 4px rounded corners (radius-md).

- **Primary (Stone)**: Stone (#78716C) fill, white (#FFFFFF) text, no border, DM Sans medium (500). Hover darkens to #57534E; active deepens to #44403C. Available in small (12px text, 32px tall, 6px 16px padding), medium (14px text, 40px tall, 10px 20px padding), and large (15px text, 48px tall, 14px 28px padding).
- **Secondary**: Transparent fill, content-primary text, 1px strong border. Hover fills with surface-sunken background.
- **Ghost**: Transparent fill, content-secondary text, no border. Hover shifts text to content-primary.
- **Destructive**: Red (#DC2626) fill, white (#FFFFFF) text, no border. Hover darkens to #B91C1C.

Disabled buttons drop to 0.35 opacity with a disabled cursor.

### Cards

- **Default**: White (#FFFFFF) raised surface with a 1px default border, 4px rounded corners, 36px padding, and no shadow.
- **Elevated**: White (#FFFFFF) raised surface with a 1px strong border, 4px rounded corners, 48px padding, and no shadow. Differentiated by the heavier border weight.

### Inputs

Inputs sit on a sunken surface (#F5F4F1) with 4px rounded corners, 10px 14px padding, and DM Sans 15px regular (400) text in content-primary. The border is 1px in the default border color.

In the default state there is no shadow. On hover the border strengthens to border-strong. On focus the border shifts to border-focus. In the error state the border turns red (error). No shadows appear in any state. When disabled the border returns to default and opacity drops to 0.35.

Labels are DM Sans 12px medium (500) in content-secondary with 6px bottom margin. Helper text is DM Sans 11px regular (400) in content-tertiary with 4px top margin; error helper text uses the error color.

### Chips

- **Filter**: Transparent fill, content-secondary text, 1px default border, 4px rounded corners, 4px 12px padding. When active the fill becomes stone and text turns white (#FFFFFF).
- **Status**: 4px rounded corners, 11px medium (500) text, 3px 10px padding. Published shows #65A30D at 8% opacity fill with #65A30D text. Draft shows #CA8A04 at 8% opacity fill with #CA8A04 text. Archived shows #A8A29E at 15% opacity fill with #78716C text. Removed shows #DC2626 at 8% opacity fill with #DC2626 text.

### Lists

Transparent background with 1px default-color dividers. Each item has 12px 16px padding and 15px content-secondary text. On hover the background shifts to surface-sunken. The active row fills with faint stone (#78716C at 6% opacity). Trailing elements include timestamps and chevrons.

### Checkboxes

16px square with 2px rounded corners and a 1px strong border. Unchecked background is surface-raised. When checked the box fills stone with a white (#FFFFFF) 1.5px-stroke checkmark. Focus shows a 2px border-focus outline offset by 2px. Disabled drops to 0.35 opacity.

### Radio Buttons

16px circular with a 1px strong border. Unchecked fill is surface-raised. When selected the border turns stone and a 6px stone inner dot appears. Focus shows a 2px border-focus outline offset by 2px. Disabled drops to 0.35 opacity.

### Tooltips

Dark (#44403C) background with white (#FFFFFF) text at 12px, 2px rounded corners, 5px 10px padding, and no shadow. A 4px arrow matches the background. Maximum width is 200px. Shows after 400ms and hides after 100ms.

---

## Do's and Don'ts

1. **Do** let the grid dictate every layout decision; no element should break the column rhythm.
2. **Don't** introduce any color outside the stone/sage palette for UI elements.
3. **Do** use light headline weights (300) for H1 and H2 to maintain the calm aesthetic.
4. **Don't** add shadows or glows; visual separation comes only from borders and background shifts.
5. **Do** use generous vertical spacing (48-120px) between major content sections.
6. **Don't** use bold or heavy font weights for body text; 400-500 maximum.
7. **Do** keep images unadorned -- no borders, no rounded corners, no overlays.
8. **Don't** center-align large blocks of text; always left-align for a clean reading line.
9. **Do** use content-tertiary for timestamps and metadata to keep them receded.
10. **Don't** use semantic colors for decorative purposes; reserve them strictly for functional states.