# Dine Guide iOS Demo

Native SwiftUI + MapKit demo for Dine Guide, a lightweight Michelin / Black Pearl guide.

## What This Proves

- Native `MapKit` map surface.
- White smoke visual wash over the system map while keeping labels readable.
- Custom waterdrop pins for Michelin and Black Pearl records.
- Tap a pin to expand a detail tag.
- Bottom horizontal restaurant list.
- iPhone ProMotion unlock flag via `CADisableMinimumFrameDurationOnPhone`.

## Open

```bash
open ios/LiteDineGuideDemo/LiteDineGuideDemo.xcodeproj
```

Then select an iPhone simulator or device and run the `LiteDineGuideDemo` scheme.

## Current Machine Note

This Mac currently points `xcodebuild` at Command Line Tools instead of full Xcode, so the project was generated and statically checked here but not built in Simulator on this machine.

## Next Demo Step

Once full Xcode is available, the next useful iteration is replacing the inline sample data with the existing Cloudflare API payload and adding a tiny local cache.
