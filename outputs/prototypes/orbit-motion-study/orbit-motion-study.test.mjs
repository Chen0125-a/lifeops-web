import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const document = new JSDOM(html).window.document;
const css = [...document.querySelectorAll("style")]
  .map((style) => style.textContent)
  .join("\n");
const scripts = [...document.querySelectorAll("script")]
  .map((script) => script.textContent)
  .join("\n");
const keyframes = (name) => {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start < 0) return "";
  const end = css.indexOf("@keyframes", start + 1);
  return css.slice(start, end < 0 ? css.length : end);
};

test("the reference geometry is reproduced as four exact concentric circles", () => {
  const rings = [...document.querySelectorAll(".orbit-ring")];

  assert.equal(rings.length, 4);
  assert.deepEqual(
    rings.map((ring) => ({
      diameter: ring.getAttribute("data-diameter"),
      direction: ring.getAttribute("data-direction"),
      duration: ring.getAttribute("data-duration"),
    })),
    [
      { diameter: "353", direction: "ccw", duration: "30" },
      { diameter: "501", direction: "cw", duration: "40" },
      { diameter: "649", direction: "cw", duration: "50" },
      { diameter: "797", direction: "ccw", duration: "60" },
    ],
  );

  assert.equal(document.querySelectorAll(".track-line, .orbit-plane").length, 0);
  assert.doesNotMatch(css, /stroke-dasharray|border-style:\s*dashed/i);
});

test("the orbit is locked to the supplied 1132 by 750 reference frame", () => {
  const stage = document.querySelector(".reference-stage");
  const scaler = document.querySelector(".orbit-scaler");
  const rings = [...document.querySelectorAll(".orbit-ring")];

  assert.ok(stage);
  assert.equal(stage.getAttribute("data-reference-width"), "1132");
  assert.equal(stage.getAttribute("data-reference-height"), "750");
  assert.equal(scaler?.getAttribute("data-center-x"), "792");
  assert.equal(scaler?.getAttribute("data-center-y"), "371");
  assert.equal(scaler?.getAttribute("data-orbit-scale"), "0.85");

  const screenDiameters = rings.map((ring) => Number(ring.getAttribute("data-diameter")) * 0.85);
  assert.deepEqual(screenDiameters, [300.05, 425.84999999999997, 551.65, 677.4499999999999]);

  assert.match(css, /\.reference-stage\s*\{[\s\S]*width:\s*1132px[\s\S]*height:\s*750px/);
  assert.match(css, /\.orbit-scaler\s*\{[\s\S]*top:\s*371px[\s\S]*left:\s*792px/);
  assert.match(css, /--orbit-scale:\s*0\.85/);
  assert.match(scripts, /Math\.min\(window\.innerWidth\s*\/\s*1132,\s*window\.innerHeight\s*\/\s*750\)/);
  assert.doesNotMatch(css, /--orbit-scale:\s*0\.68|--orbit-scale:\s*0\.866/);
});

test("the four tracks use the exact uncompensated masked gradient", () => {
  assert.match(
    css,
    /linear-gradient\(180deg,\s*rgba\(217,\s*161,\s*255,\s*0\)\s*0%,\s*rgba\(217,\s*161,\s*255,\s*1\)\s*43%,\s*rgba\(217,\s*161,\s*255,\s*0\)\s*100%\)/,
  );
  assert.match(css, /--track-width:\s*1px/);
  assert.match(css, /\.orbit-ring::before\s*\{[\s\S]*padding:\s*var\(--track-width\)/);
  assert.doesNotMatch(css, /--track-opacity|--track-width:\s*1\.(?:25|47|72)px|--track-width:\s*(?:2\.38|3\.125)px/);
  assert.doesNotMatch(css, /\.orbit-ring::after\s*\{/);
  assert.doesNotMatch(css, /drop-shadow\(/);
});

test("the entire ring group uses the reference scale entrance", () => {
  assert.match(css, /orbit-scale-in\s+1\.2s\s+cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)\s+0\.3s\s+both/);
  const scaleIn = css.match(/@keyframes orbit-scale-in\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  assert.match(scaleIn, /opacity:\s*0/);
  assert.match(scaleIn, /transform:\s*scale\(0\.85\)/);
  assert.doesNotMatch(scaleIn, /blur\(/);
});

test("five LifeOps objects spiral from 0.3R and A-180 degrees before joining their live rings", () => {
  const objects = [...document.querySelectorAll(".orbit-object")];
  const orbitWindow = document.querySelector(".orbit-window");

  assert.equal(objects.length, 5);
  assert.deepEqual(
    objects.map((object) => object.getAttribute("data-object")),
    ["moment", "doing", "learning", "life-slice", "archive"],
  );
  assert.deepEqual(
    objects.map((object) => object.getAttribute("data-material")),
    ["sundial", "flag", "paper-book", "viewfinder", "archive-rings"],
  );
  assert.deepEqual(
    objects.map((object) => object.getAttribute("data-angle")),
    ["314", "236", "161", "96", "88"],
  );

  const orbitObjectRule = css.match(/\.orbit-object\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(orbitObjectRule, /animation:\s*object-track-arrive\s+0\.72s\s+cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)\s+var\(--fly-delay\)\s+both/);

  const trackArrival = keyframes("object-track-arrive");
  assert.match(trackArrival, /rotate\(calc\(var\(--object-angle\)\s*-\s*180deg\)\)\s*translateX\(calc\(var\(--diameter\)\s*\*\s*0\.15px\)\)/);
  assert.match(trackArrival, /rotate\(var\(--object-angle\)\)\s*translateX\(calc\(var\(--diameter\)\s*\*\s*0\.5px\)\)/);

  assert.ok(objects.every((object) => object.querySelector(":scope > .object-upright > .path-counter > .object-fly")));
  assert.match(css, /\.path-counter\s*\{[\s\S]*animation:\s*object-path-counter\s+0\.72s\s+cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)\s+var\(--fly-delay\)\s+both/);
  assert.match(keyframes("object-path-counter"), /rotate\(180deg\)[\s\S]*rotate\(0\)/);

  assert.equal(orbitWindow?.getAttribute("data-launch-duration"), "0.72");
  assert.equal(orbitWindow?.getAttribute("data-launch-radius-from"), "0.3");
  assert.equal(orbitWindow?.getAttribute("data-launch-angle-from"), "-180");
  assert.deepEqual(
    objects.map((object) => object.getAttribute("data-delay")),
    ["0.60", "0.80", "1.00", "1.20", "1.40"],
  );
  const delays = objects.map((object) => Number(object.getAttribute("data-delay")));
  assert.ok(delays.every((delay, index) => index === 0 || Math.abs(delay - delays[index - 1] - 0.2) < 1e-9));

  assert.match(css, /\.object-fly\s*\{[\s\S]*animation:\s*object-fly-in\s+0\.72s\s+cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)\s+var\(--fly-delay\)\s+both/);
  assert.match(css, /@keyframes\s+object-fly-in\s*\{[\s\S]*opacity:\s*0[\s\S]*scale\(0\.3\)\s+rotate\(-180deg\)[\s\S]*blur\(10px\)[\s\S]*18%\s*\{\s*opacity:\s*1[\s\S]*scale\(1\)\s+rotate\(0\)[\s\S]*blur\(0\)/);
  assert.doesNotMatch(css, /object-orbit-launch|--launch-offset|translateX\(0(?:px)?\)/);

  const bezierProgress = (timeFraction) => {
    const sample = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
    let low = 0;
    let high = 1;
    for (let index = 0; index < 48; index += 1) {
      const middle = (low + high) / 2;
      if (sample(middle, 0.22, 0.36) < timeFraction) low = middle;
      else high = middle;
    }
    return sample((low + high) / 2, 1, 1);
  };

  const expectedSamples = [
    { milliseconds: 0, radius: 0.3, angleOffset: -180, scale: 0.3, blur: 10 },
    { milliseconds: 100, radius: 0.666068, angleOffset: -85.868, scale: 0.666068, blur: 4.77 },
    { milliseconds: 200, radius: 0.863369, angleOffset: -35.134, scale: 0.863369, blur: 1.952 },
    { milliseconds: 300, radius: 0.948687, angleOffset: -13.195, scale: 0.948687, blur: 0.733 },
  ];

  for (const expected of expectedSamples) {
    const eased = bezierProgress(expected.milliseconds / 720);
    const actual = {
      radius: 0.3 + 0.7 * eased,
      angleOffset: -180 * (1 - eased),
      scale: 0.3 + 0.7 * eased,
      blur: 10 * (1 - eased),
    };
    assert.ok(Math.abs(actual.radius - expected.radius) < 0.0006, `radius at ${expected.milliseconds}ms`);
    assert.ok(Math.abs(actual.angleOffset - expected.angleOffset) < 0.06, `angle at ${expected.milliseconds}ms`);
    assert.ok(Math.abs(actual.scale - expected.scale) < 0.0006, `scale at ${expected.milliseconds}ms`);
    assert.ok(Math.abs(actual.blur - expected.blur) < 0.006, `blur at ${expected.milliseconds}ms`);
  }
});

test("the authored phases stay balanced during continuous rotation", () => {
  const objects = [...document.querySelectorAll(".orbit-object")];

  for (let elapsed = 0; elapsed <= 18; elapsed += 3) {
    const quadrants = [0, 0, 0, 0];

    for (const object of objects) {
      const ring = object.closest(".orbit-ring");
      const angle = Number(object.getAttribute("data-angle"));
      const direction = ring?.getAttribute("data-direction") === "cw" ? 1 : -1;
      const duration = Number(ring?.getAttribute("data-duration"));
      const current = (angle + direction * (360 / duration) * elapsed + 3600) % 360;
      quadrants[Math.floor(current / 90) % 4] += 1;
    }

    assert.ok(quadrants.every((count) => count >= 1), `empty quadrant at ${elapsed}s: ${quadrants}`);
    assert.ok(quadrants.every((count) => count <= 2), `crowded quadrant at ${elapsed}s: ${quadrants}`);
  }
});

test("the center counts from 00 to 05 above the approved poetic line", () => {
  const center = document.querySelector(".orbit-center");

  assert.ok(center);
  assert.equal(center.getAttribute("data-count-target"), "5");
  assert.equal(center.getAttribute("data-count-delay"), "1200");
  assert.equal(center.getAttribute("data-count-duration"), "2000");
  assert.equal(center.querySelector(".orbit-count")?.textContent?.trim(), "05");
  assert.equal(center.querySelector(".orbit-count-label")?.textContent?.trim(), "此刻正在发生");
  assert.match(scripts, /1\s*-\s*\(1\s*-\s*progress\)\s*\*\*\s*3/);
  assert.match(scripts, /String\(value\)\.padStart\(2,\s*"0"\)/);
});

test("the sample contains only the orbit system on the LifeOps star field", () => {
  assert.equal(document.querySelectorAll("header, .hero-copy, .hero-action, .hero-title").length, 0);
  assert.equal(document.querySelectorAll(".orbit-object svg[data-shape]").length, 5);
  assert.match(css, /rgba\(181,\s*103,\s*255,\s*0\.68\)/);
  assert.match(css, /#stars\s*\{[\s\S]*opacity:\s*0\.48/);
  assert.match(scripts, /innerWidth\s*\*\s*window\.innerHeight\)\s*\/\s*15000/);
  assert.match(css, /\.orbit-count\s*\{[\s\S]*font-size:\s*54px/);
  assert.match(css, /\.object-fly\s*\{[\s\S]*border:\s*0[\s\S]*background:\s*transparent[\s\S]*box-shadow:\s*none/);
});
