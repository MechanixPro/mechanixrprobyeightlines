"""Builds assets/data/sphere.json: the customer-facing subset of the sphere avatar the owner designed.
Only the expressions and animations the site uses are kept (calm, friendly ones), values rounded, body recoloured to brand navy.
Run: python3 scripts/make_sphere.py"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def eye(w, h, y=0, a=0): return {'width': w, 'height': h, 'x': 0, 'y': y, 'angle': a}
def ex(hx, hy, hz, l, r, sp): return {'head': {'x': hx, 'y': hy, 'z': hz}, 'eyes': {'left': l, 'right': r, 'spacing': sp}}
E_ = {
  'neutral': ex(0, 0, 0, eye(20, 50, -7), eye(20, 50, -7), 35),
  'upward-side-glance': ex(7.3, 27.8, -16.1, eye(22.5, 42.38, -20.5), eye(22.5, 42.38, -20.5), 54.3),
  'curious-left': ex(-12.3, -17.6, 5.91, eye(20.61, 47.77, 0, 23.52), eye(20.61, 47.77, 0, -24.04), 54.9),
  'joyful-down-right': ex(-15.29, 15.01, 12.79, eye(31.25, 76.72), eye(31.25, 76.72), 68.7),
  'joyful-wide': ex(-2.09, -15.9, -14.47, eye(34.2, 85.33), eye(34.2, 83.18), 59.41),
  'playful-right': ex(-4.4, 14.07, -16.13, eye(19.05, 43.37, 0, 26.29), eye(19.05, 43.37, 0, -20.25), 51.73),
  'gentle-downward-gaze': ex(-6.08, -11.04, -13.97, eye(23.05, 58.69), eye(23.05, 58.69), 56.2),
  'surprised-left': ex(2.95, -16.05, -20.92, eye(51.68, 51.74), eye(51.68, 51.74), 70.9),
  'surprised-wide-left': ex(-5.43, -11.71, -13.47, eye(51.4, 50.1), eye(50.5, 49.4), 69),
  'far-right-glance': ex(0.32, 35.31, -10.9, eye(22.46, 39.82), eye(22.46, 39.82), 53.9),
  'attentive-left': ex(1.43, 6.19, 10.56, eye(23.84, 58.13), eye(23.84, 58.13), 56.8),
  'downward-gaze': ex(-15.06, 0.14, -14.55, eye(22.4, 54.57), eye(22.4, 54.57), 57.7),
}
def anim(steps, hold, blink, tr=500): return {'steps': [{'expression': s, 'holdMs': hold, 'transitionMs': tr} for s in steps], 'blink': blink}
B = lambda i, lo, hi, d: {'initialDelayMs': i, 'minIntervalMs': lo, 'maxIntervalMs': hi, 'durationMs': d}
A_ = {
  'idle': anim(['upward-side-glance', 'curious-left'], 5200, B(2600, 3400, 6200, 280)),
  'happy': anim(['joyful-down-right', 'joyful-wide', 'playful-right', 'gentle-downward-gaze'], 2300, B(2100, 2800, 5000, 260)),
  'curious': anim(['surprised-left', 'surprised-wide-left', 'upward-side-glance', 'far-right-glance'], 2300, B(2100, 2800, 5000, 260)),
  'listening': anim(['attentive-left', 'downward-gaze', 'gentle-downward-gaze'], 2300, B(3200, 4800, 7200, 240)),
  'celebrate': anim(['joyful-down-right', 'curious-left', 'playful-right'], 2300, B(1200, 1800, 3600, 220)),
}
out = {'schema': 'mechanix-pro/sphere', 'size': 240, 'colors': {'body': '#14295A', 'eyes': '#ffffff'}, 'expressions': E_, 'animations': A_}
p = os.path.join(ROOT, 'assets', 'data', 'sphere.json')
os.makedirs(os.path.dirname(p), exist_ok=True)
json.dump(out, open(p, 'w'), separators=(',', ':'))
print('wrote', p, os.path.getsize(p), 'bytes')
