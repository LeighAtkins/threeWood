# Shot Deflection Warning System

## Goal
- Prevent frustrating "impossible" shots by warning the player when their shot will deflect off steep terrain (e.g., a wall or steep slope).
- Visual feedback:
  - Arrow is **green** when the shot is clear (will launch forward).
  - Arrow is **red** when the shot will deflect (e.g., aiming into a wall or steep slope).

## Outline Plan

1. **Detect Deflection Risk**
   - When aiming, calculate the angle between the shot direction and the terrain normal at the ball's position.
   - If the angle is too steep (e.g., > 45° from the normal), consider it a deflection risk.
2. **Update Arrow Color**
   - If the shot is clear, set the arrow color to green.
   - If the shot is a deflection risk, set the arrow color to red.
3. **(Optional) Show a Tooltip or Warning**
   - Optionally, display a tooltip or warning text if the shot is risky.

## Step-by-Step Checklist

- [x] **Step 1:** In aiming mode, get the terrain normal at the ball's position.
- [x] **Step 2:** Calculate the shot direction vector (from the current aim).
- [x] **Step 3:** Compute the angle between the shot direction and the terrain normal.
- [x] **Step 4:** If the angle is above a threshold (e.g., > 45°), set the arrow color to red; otherwise, set it to green.
- [ ] **Step 5:** (Optional) Display a warning or tooltip for risky shots. **(Skipped as per user request)**
- [ ] **Step 6:** Test with various terrain slopes and aiming directions to ensure the feedback is accurate and intuitive.

---

This file documents the plan and checklist for implementing the shot deflection warning system in the golf game project. 