/* RC Calc: "i" information buttons. A glossary of every parameter, matched to labels, stat tiles, table headers,
   legends and readout pills on all pages, with one shared hover/focus tooltip. Classic script, no dependencies. */
'use strict';
(() => {
  /* Each entry: aliases (normalised label text, see norm()), title, explanation, optional typical range. */
  const G = [
    // ---------- weight ----------
    [['all-up weight', 'auw', 'single auw', 'all-up weight for analysis', 'total auw', 'measured weight'], 'All-up weight (AUW)',
      'The weight of the complete plane ready to fly: airframe, motor, prop, ESC, battery, receiver, servos, wiring and any payload. Almost everything scales with it: stall speed, the power you need, flight time and how hard the landings are. Weigh the finished plane on a kitchen scale and use that number for the most honest results.', 'Small foam park flyers: 150–400 g'],
    [['weight budget'], 'Weight budget', 'Builds the all-up weight from a list of parts instead of one number, so you can see where the grams go and what changes if you pick a bigger battery or a lighter motor.'],
    [['airframe'], 'Airframe weight', 'The structure only: wing, tail, fuselage, glue, tape and covering, without any electronics. For foam it is roughly sheet area × density; balsa builds are lighter per area but need covering film.'],
    [['payload'], 'Payload', 'Extra weight you want to carry that is not needed to fly, such as an FPV camera, a GPS logger or a candy drop. It is added to the all-up weight, so it raises the stall speed and the power needed.'],
    [['wiring / misc', 'wiring'], 'Wiring and small parts', 'Connectors, battery leads, extension cables, pushrods, horns, hinges, screws and velcro. On small planes these few grams add up; allow 5–10 % of the all-up weight.'],
    [['electronics weight'], 'Electronics weight', 'Motor, ESC, battery, servos and receiver added together. On a foam plane this is usually more than half of the all-up weight, so choosing these parts matters more than shaving foam.'],
    // ---------- wing geometry ----------
    [['wingspan', 'span', 'target span'], 'Wingspan', 'The distance from wing tip to wing tip. A longer span (at the same area) means a higher aspect ratio: less induced drag, a better glide and gentler handling, but a heavier, more flexible wing that rolls more slowly.'],
    [['span & chord'], 'Span and chord', 'Describe the wing by its tip-to-tip span and its chord (front-to-back width). Wing area = span × average chord.'],
    [['chord', 'chord rectangular wing'], 'Chord', 'The width of the wing from the leading edge (front) to the trailing edge (back). Wider chord = more area and a gentler stall, but lower aspect ratio.'],
    [['root chord'], 'Root chord', 'The chord where the wing meets the fuselage (the centre of the wing). It is usually the widest point and carries most of the load.'],
    [['tip chord'], 'Tip chord', 'The chord at the wing tip. A smaller tip chord (taper) saves weight and induced drag, but too much taper makes the tips stall first, which drops a wing at low speed. Washout helps.'],
    [['wing area', 'area directly', 'area'], 'Wing area', 'The area of the wing seen from above, including the part inside the fuselage. Together with the weight it sets the wing loading and the stall speed: more area flies slower.', 'Shown in dm² (1 dm² = 100 cm²)'],
    [['aspect ratio', 'ar'], 'Aspect ratio (AR)', 'Span² ÷ wing area: how long and slender the wing is. High AR (gliders, 10+) gives low induced drag and a flat glide; low AR (aerobats, flying wings, 4–6) gives fast roll, a strong structure and docile stalls.', 'Trainers 5–7 · sport 5–6 · gliders 9–14'],
    [['mac'], 'Mean aerodynamic chord (MAC)', 'The chord of an imaginary rectangular wing that has the same lift and pitching behaviour as your tapered or swept wing. The CG, neutral point and static margin are measured along the MAC, as a percentage of it.'],
    [['mac leading edge'], 'MAC leading edge', 'Where the front of the mean aerodynamic chord sits, measured back from the wing root leading edge. On a swept wing it is behind the root LE; CG percentages are measured from this point.'],
    [['wing loading'], 'Wing loading', 'Weight divided by wing area. It is the single best predictor of how slowly and gently a plane can fly: low loading = slow, floaty, easy to land; high loading = fast, needs more speed to take off and land.', 'Indoor < 10 g/dm² · trainers 15–30 · sport 30–50'],
    [['dihedral'], 'Dihedral', 'The upward angle of each wing half. With dihedral, a plane that is banked and slipping gets more lift on the low wing and rolls back level by itself. Rudder-only planes need a lot (6–10° each side); aileron planes 0–4°.'],
    [['le sweep'], 'Leading-edge sweep', 'How far the leading edge is angled back. Sweep moves the wing\'s lift (and the neutral point) aft, adds stability in yaw and roll, and is essential on flying wings so the tips act like a tail.', 'Straight wings 0–5° · flying wings 20–35°'],
    [['washout'], 'Washout', 'A twist that gives the wing tips a lower angle of attack than the root. The root then stalls first, so the ailerons keep working and the plane does not snap a wing down at low speed. Flying wings also need it for pitch stability.', 'Straight wings 1–3° · flying wings 2–5°'],
    [['wing mount'], 'Wing position', 'High wing: very stable (the fuselage hangs below like a pendulum, adds effective dihedral), ideal for trainers. Mid wing: neutral, best for aerobatics. Low wing: less self-levelling, sporty, needs more dihedral.'],
    [['semispan'], 'Semispan position', 'Distance from the wing root out to the tip, in percent of one wing half (0 % = root, 100 % = tip).'],
    // ---------- tail & fuselage ----------
    [['fuselage length'], 'Fuselage length', 'Nose to tail. A longer fuselage gives the tail more leverage (larger tail arm), so you can use a smaller tail and the plane is steadier in pitch and yaw. Too short makes it twitchy.', 'Typically 70–80 % of the span'],
    [['tail arm'], 'Tail arm', 'Distance from the wing\'s quarter-chord to the tail\'s quarter-chord. Tail effectiveness grows with arm × area, so a long arm lets you use a small, light tail.'],
    [['h-tail span'], 'Horizontal tail span', 'Width of the horizontal stabiliser (tailplane) from tip to tip. With the H-tail chord it sets the tail area; set it to 0 for a tailless (flying wing) design.'],
    [['h-tail chord'], 'Horizontal tail chord', 'Front-to-back depth of the horizontal stabiliser including the elevator.'],
    [['h-tail'], 'Horizontal tail size', 'Horizontal tail area as a percentage of the wing area.', 'Typically 15–25 %'],
    [['v-tail height', 'fin height'], 'Fin height', 'Height of the vertical fin (and rudder) above the fuselage. A bigger fin gives more directional (weathercock) stability and rudder authority.'],
    [['v-tail root chord', 'fin chord'], 'Fin chord', 'Front-to-back length of the fin at its base, including the rudder.'],
    [['v-tail'], 'Vertical tail size', 'Fin area as a percentage of the wing area.', 'Typically 8–12 %'],
    [['tail volume vh', 'vh'], 'Horizontal tail volume (Vh)', 'Tail area × tail arm ÷ (wing area × MAC). It measures how much pitch stability and damping the tail gives. Too small: twitchy in pitch and a narrow CG range; too large: heavy and slow to respond.', 'Typical 0.35–0.6 (trainers ≈ 0.5)'],
    [['tail volume vv', 'vv'], 'Vertical tail volume (Vv)', 'Fin area × fin arm ÷ (wing area × span). It sets directional stability: too small and the plane wags its tail and slips; too large and it can spiral in turns.', 'Typical 0.02–0.05'],
    [['body style', 'preset', 'configuration'], 'Configuration', 'The overall layout (trainer, low-wing sport, flying wing, chuck glider). It sets sensible proportions for the tail, fuselage, motor position and controls; you can then edit each number.'],
    [['motor position'], 'Motor position', 'Tractor: motor in the nose pulling (simple, prop wash over the tail improves control). Pusher: motor at the back pushing (prop safer in crashes, good for wings and FPV, but no wash over the tail).'],
    [['airfoil'], 'Airfoil', 'The cross-section shape of the wing. Camber (curve) gives lift at zero angle and a high maximum lift for slow flight; thin symmetric sections fly inverted equally well; reflexed sections are needed by flying wings.'],
    // ---------- CG & stability ----------
    [['cg', 'current cg', 'cg for this flight'], 'Centre of gravity (CG)', 'The balance point: where the plane balances on your fingertips, given as a percentage of the MAC from its leading edge. It must be ahead of the neutral point or the plane is unstable in pitch. Forward = stable but needs more up-elevator; aft = lively, then uncontrollable.', 'Most planes: 25–33 % MAC'],
    [['recommended cg'], 'Recommended CG', 'The CG that gives your chosen static margin. Balance the finished plane here (with the battery installed) for the first flight, then fine-tune.'],
    [['safe cg range'], 'Safe CG range', 'From the forward limit (the elevator can still flare and lift the nose) to the aft limit (still about 5 % static margin). Outside it the plane is either hard to land or unstable.'],
    [['cg at 10% margin'], 'CG at 10 % static margin', 'The balance point that leaves 10 % of the MAC between the CG and the neutral point: a calm, forgiving setting for first flights.'],
    [['cg from root le', 'balance point behind wing root le'], 'CG from the wing root leading edge', 'The recommended balance point measured straight back from the leading edge at the wing root, which is where you actually put your fingers when balancing.'],
    [['neutral point'], 'Neutral point (NP)', 'The aerodynamic balance point of the whole plane: the CG position at which it would have no pitch stability at all. Like a weathervane, the CG must be ahead of it. Bigger tails and longer tail arms move it aft.', 'Usually 35–50 % MAC for planes with a tail'],
    [['static margin', 'target static margin'], 'Static margin', 'Distance from the CG to the neutral point, as a percentage of the MAC. It measures pitch stability: larger = steadier but less responsive and needs more elevator to flare.', 'Trainers 10–15 % · sport 5–10 % · aerobats 2–5 %'],
    [['spiral index b'], 'Spiral stability index B (Blaine)', 'Blaine\'s rule of thumb: B = (fin arm ÷ span) × (dihedral + ½ × sweep, in degrees) ÷ cruise CL. It tells you whether a plane that is banked slightly will level its wings by itself (B ≥ 5) or slowly tighten into a spiral dive. More dihedral, a longer tail or flying faster (lower CL) raises B.', '≥ 5 self-levels; rudder-only planes need ≥ 5'],
    [['angle of attack'], 'Angle of attack (α)', 'The angle between the wing chord and the oncoming air. Lift grows with it until the stall (around 12–15° for most sections), where the airflow separates and lift drops.'],
    // ---------- airfoil & wing aerodynamics ----------
    [['clmax', 'clmax 2d'], 'Maximum lift coefficient (CLmax)', 'The highest lift coefficient the airfoil reaches before it stalls. Higher CLmax means a lower stall speed for the same wing. The 2D figure is for an infinite wing; a real 3D wing reaches about 85–90 % of it.', 'Flat plate 0.8 · Clark Y 1.2 · NACA 6409 1.4'],
    [['wing clmax'], 'Wing CLmax (3D)', 'Maximum lift coefficient of the whole finite wing, from the lifting-line analysis: the section CLmax reduced by tip losses, taper and twist. It is what sets your real stall speed.'],
    [['zero-lift angle'], 'Zero-lift angle (α₀)', 'The angle of attack at which the airfoil makes no lift. Cambered sections have a negative zero-lift angle (they still lift at 0°); symmetric sections have 0°.'],
    [['cm about c/4', 'cm'], 'Pitching moment coefficient (Cm)', 'How much a cambered airfoil tries to pitch the nose down, measured about its quarter-chord. The tail (or reflex on a flying wing) has to balance this; a big negative Cm means more tail download and drag.'],
    [['profile drag cd0', 'cd0'], 'Profile drag coefficient (cd0)', 'Drag of the airfoil section from skin friction and pressure, at low lift. Thin, smooth sections are lower; thick foam and flat plates higher.'],
    [['zero-lift drag cd0'], 'Zero-lift drag (CD0)', 'Drag of the whole plane that does not depend on lift: wing profile drag plus fuselage, tail, landing gear and interference. It dominates at high speed and sets the top speed.'],
    [['lift slope'], 'Lift-curve slope', 'How quickly the lift coefficient rises with angle of attack, per radian. About 2π for an infinite wing, less for a real wing (lower aspect ratio = shallower slope = softer response to gusts).'],
    [['max camber'], 'Maximum camber', 'How far the airfoil\'s centre line curves above the chord, as a percentage of the chord. More camber = more lift at low speed and a gentler stall, but more drag and nose-down moment.'],
    [['thickness'], 'Thickness', 'The maximum thickness of the airfoil as a percentage of the chord. Thicker sections stall more gently and allow a stronger spar; thinner ones are faster.', 'Typical 8–15 %'],
    [['span efficiency e', 'span efficiency'], 'Span efficiency (Oswald) e', 'How close the wing\'s lift distribution is to the ideal elliptical one (e = 1). Lower e means more induced drag for the same lift. Taper ratios around 0.45 and a little washout give the best values on simple wings.', 'Good straight wings 0.85–0.95'],
    [['cruise cl'], 'Cruise lift coefficient', 'The lift coefficient the wing must make to hold your weight at cruise speed: CL = 2W ÷ (ρ·V²·S). Low values mean the plane is cruising fast relative to its stall; above about 0.8 you are flying close to the stall.', 'Comfortable cruise 0.3–0.6'],
    [['induced drag cdi'], 'Induced drag (CDi)', 'The drag that comes from making lift: the wing tip vortices. CDi = CL² ÷ (π·AR·e), so it is largest at low speed and on short, stubby wings.'],
    [['stall starts at'], 'Where the stall starts', 'The spanwise position that reaches its maximum lift first. Near the root is good (the ailerons keep working); near the tip means the plane can drop a wing, so add washout or less taper.'],
    [['cl ÷ clmax'], 'Lift used ÷ lift available', 'How close each part of the wing is to stalling at the analysed condition. The highest value shows where the stall will begin.'],
    [['elliptic', 'your wing', 'load', 'share'], 'Spanwise lift distribution', 'How the lift is spread from root to tip, compared with the ideal elliptical distribution. A distribution close to elliptic has the least induced drag; more load at the root gives safer stalls.'],
    [['panel'], 'Wing panel', 'One straight section of a multi-panel wing (for example a straight centre with tapered outer panels). Each panel has its own span, chord, sweep and dihedral.'],
    // ---------- speeds & performance ----------
    [['stall speed', 'target stall speed', 'stall', 'stall predicted'], 'Stall speed', 'The slowest speed at which the wing can hold the plane up in level flight: V = √(2W ÷ (ρ·S·CLmax)). Landings happen at about 1.2–1.3 × this. Lower = easier, slower landings.', 'Trainers 4–7 m/s'],
    [['cruise ÷ stall'], 'Cruise ÷ stall speed', 'How much faster than the stall you plan to cruise. 1.4–1.6 is relaxed and efficient; higher is sporty.'],
    [['cruise speed', 'trim speed'], 'Cruise speed', 'The airspeed of comfortable level flight. The simulator trims the plane here: elevator and throttle set for straight and level.'],
    [['top speed', 'top speed level'], 'Top speed', 'The fastest level speed at full throttle, where the thrust left over at that speed equals the drag. It is limited by the prop\'s pitch speed and the plane\'s zero-lift drag.'],
    [['best glide', 'glide ratio', 'l/d max'], 'Best glide ratio (L/D max)', 'How far the plane glides for each metre of height lost with the motor off, at the best speed. 10:1 means 100 m forward from 10 m up. It is also the most efficient cruise in drag terms.', 'Foam trainers 7–10 · gliders 12–20'],
    [['glide speed'], 'Best glide speed', 'The airspeed that gives the flattest glide (highest L/D). Faster or slower than this, you come down more steeply.'],
    [['min sink', 'sink rate'], 'Minimum sink rate', 'The slowest rate of descent with the motor off, flown a bit slower than best glide. It decides how long a glider can stay up and how weak a thermal it can use.', 'Thermal gliders 0.3–0.5 m/s'],
    [['max climb rate', 'full-throttle climb', 'climb'], 'Maximum climb rate', 'How fast the plane can gain height at full throttle: (thrust − drag) × speed ÷ weight, at the best climb speed.', 'Trainers 2–4 m/s · aerobats 8+ m/s'],
    [['cruise power', 'power required'], 'Power for cruise', 'Electrical power (W) the motor draws to hold level flight at cruise speed. It decides the flight time: Wh in the battery ÷ watts.'],
    [['endurance at cruise', 'flight time'], 'Flight time', 'How long the battery lasts at the cruise throttle, keeping 20 % in reserve. Real flights with climbs and turns are shorter, roughly ⅓–½ of the steady value.'],
    [['target power'], 'Target power', 'The electrical power the motor should handle at full throttle, from the all-up weight × watts per kilogram for your flying style.'],
    [['w/kg override'], 'Watts per kilogram', 'Full-throttle electrical power per kilogram of all-up weight. It is the usual way to size a power system for a flying style.', 'Gentle 100–150 · sport 150–250 · aerobatic 250+ W/kg'],
    [['t/w'], 'Thrust-to-weight ratio', 'Static thrust divided by weight. Below 0.5 the plane climbs slowly and needs a runway; around 1 it can climb steeply; above 1 it can hang on the prop and climb vertically.'],
    [['thrust', 'static thrust', 'thrust available'], 'Thrust', 'The pull of the prop. Static thrust (at standstill) is the highest; it drops as the plane speeds up and reaches zero near the prop\'s pitch speed.'],
    [['drag'], 'Drag', 'The total air resistance: zero-lift drag (grows with speed²) plus induced drag (largest at low speed). Where thrust equals drag is the top speed.'],
    [['airspeed', 'airspeed m/s'], 'Airspeed', 'Speed of the plane relative to the air, which is what the wing feels. Ground speed is airspeed plus or minus the wind.'],
    // ---------- power system ----------
    [['motor'], 'Motor', 'The brushless outrunner that turns the prop. Its size (e.g. 2204 = 22 mm stator, 4 mm tall), KV and maximum current must suit the prop and battery; the Designer matches them for you.'],
    [['motor kv', 'kv'], 'Motor KV', 'RPM per volt with no load. Low KV (700–1200) swings big props slowly: lots of thrust, slow flying. High KV (1800+) spins small props fast: speed. Higher KV on the same prop draws much more current.'],
    [['rm'], 'Winding resistance Rm', 'The motor\'s internal resistance (ohms). It turns current into heat: losses grow with current², so a low Rm means a more efficient, cooler motor at high power.'],
    [['io'], 'No-load current Io', 'The current the motor draws spinning with no prop (bearing and iron losses). It is wasted power; low Io matters most at part throttle.'],
    [['max current', 'max a'], 'Maximum motor current', 'The current the motor can take continuously without overheating. Your prop should draw less than this at full throttle, with some margin.'],
    [['max power', 'max w'], 'Maximum motor power', 'The electrical power the motor is rated for. Stay below it at full throttle, especially in hot weather.'],
    [['motor efficiency', 'efficiency'], 'Motor efficiency', 'Share of the battery power that ends up as shaft power. Small brushless motors run at 65–85 %; the rest is heat in the windings and iron.'],
    [['prop efficiency'], 'Prop efficiency', 'Share of the shaft power that becomes useful thrust power. Small props in cruise reach 0.55–0.7; much lower when static or far off their design speed.'],
    [['prop'], 'Propeller', 'Named diameter × pitch in inches, for example 8×3.8. Diameter mostly sets thrust and load; pitch sets the speed it can push the plane to.'],
    [['prop diameter', 'max prop diameter'], 'Prop diameter', 'Tip-to-tip size in inches. Bigger props make more thrust per watt (more efficient, better for slow planes) but load the motor much harder: power grows roughly with diameter⁴.'],
    [['pitch'], 'Prop pitch', 'How far the prop would screw forward in one turn, in inches. More pitch = higher top speed but more load and less static thrust per watt.'],
    [['pitch speed'], 'Pitch speed', 'RPM × pitch: the speed at which the prop would stop pushing. Top speed is usually 70–90 % of it.', 'Aim for 1.5–2 × cruise speed'],
    [['× cruise', 'pitch ×cruise'], 'Pitch speed ÷ cruise speed', 'How much faster the prop could push than your cruise speed. Below about 1.3 the plane runs out of thrust in the climb; above 2.5 the prop is inefficient at cruise.'],
    [['rpm'], 'RPM', 'Prop revolutions per minute under load (lower than KV × volts because the prop and the battery sag pull it down).'],
    [['rpm load factor'], 'RPM load factor', 'Loaded RPM as a fraction of KV × battery voltage. A prop that suits the motor runs at about 75–85 % of its no-load speed.'],
    [['prop power coeff. cp', 'cp'], 'Prop power coefficient Cp', 'How hard the prop is to turn: power = Cp·ρ·n³·D⁵. Typical slow-fly and electric props are 0.03–0.06; more pitch means a higher Cp.'],
    [['figure of merit'], 'Figure of merit', 'Static prop efficiency: the share of shaft power that turns into ideal hover/static thrust power. 0.5–0.7 for small props; it is used to estimate static thrust.'],
    [['esc'], 'Speed controller (ESC)', 'Turns the throttle signal into motor drive. Pick one rated for at least 1.3–1.5 × the full-throttle current. Most small ESCs include a BEC that powers the receiver and servos.'],
    [['est. power', 'power in'], 'Electrical power', 'Battery voltage × current at full throttle: the power the motor draws.'],
    [['current'], 'Current', 'Amps drawn from the battery. It sets how quickly the battery empties and how hot the motor, ESC and battery get.'],
    [['continuous'], 'Continuous rating', 'What the part can handle for minutes on end, as opposed to a short burst.'],
    [['power system'], 'Power system', 'Motor, prop and battery together. The simulator builds its thrust and current tables from the motor model with this combination.'],
    [['fit', 'rank'], 'Match quality', 'How well this motor and prop combination meets the target power, pitch speed and current limits. The best fits are listed first.'],
    // ---------- battery ----------
    [['battery'], 'Battery', 'A LiPo pack: the number of cells in series (S) sets the voltage, the capacity (mAh) sets how much energy it holds, and the C rating sets how much current it can deliver. It is also the main ballast for setting the CG.'],
    [['cells', 'cells s', 'battery cells', 'cells min–max'], 'Cells (S)', 'Number of LiPo cells in series. Each adds 3.7 V nominal (4.2 V full). More cells = more voltage, so more RPM and power from the same motor and prop.'],
    [['capacity', 'battery capacity'], 'Battery capacity', 'Charge stored, in milliamp-hours. 1000 mAh delivers 1 A for one hour. Doubling the capacity roughly doubles the flight time, but also the battery weight.'],
    [['c rating'], 'C rating', 'Maximum safe discharge current as a multiple of the capacity: a 500 mAh 20C pack can deliver 10 A. Choose at least 1.5 × your full-throttle current.'],
    [['loaded v per cell'], 'Loaded voltage per cell', 'Voltage of each cell while the motor is drawing current. It sags below 3.7 V under load; 3.5 V is a realistic average for flight.'],
    [['usable battery fraction'], 'Usable battery', 'How much of the capacity you plan to use. Landing with about 20 % left (0.8) keeps the LiPo healthy and gives a safety reserve.'],
    [['average throttle for flight-time estimate', 'at average throttle'], 'Average throttle', 'The mean throttle over a typical flight. Gentle flying averages 40–50 %; aerobatics more.'],
    // ---------- radio & controls ----------
    [['receiver'], 'Receiver', 'Picks up the transmitter signal and drives the servos and ESC. You need at least one channel per control surface plus throttle.'],
    [['servo × count', 'servo × count', 'number of servos', 'servos'], 'Servos', 'Small motors that move the control surfaces. Micro servos (4–9 g) are enough for foam planes under about 500 g.'],
    [['control surfaces'], 'Control surfaces', 'Ailerons (roll), elevator (pitch), rudder (yaw), flaps (slow flight) or elevons (roll and pitch combined on a flying wing).'],
    [['controls & flight'], 'Controls and flight', 'Which control surfaces the plane has and how you plan to fly it.'],
    [['aileron chord', 'elevator chord', 'rudder chord', 'flap chord', 'elevon chord'], 'Control-surface chord', 'The share of the local chord that moves. Larger surfaces are more powerful but more sensitive and add drag; 20–30 % is typical, 35–45 % for 3D aerobats.'],
    [['aileron from span', 'aileron to span', 'flap from span', 'flap to span', 'elevon from span', 'elevon to span'], 'Surface span position', 'Where along the wing half the surface starts and ends (0 % = root, 100 % = tip). Outboard ailerons are more powerful in roll; flaps sit inboard of the ailerons.'],
    [['aileron throw', 'elevator throw', 'rudder throw', 'flap throw'], 'Control throw', 'How far the surface moves at full stick, in degrees. Too little and the plane is sluggish; too much and it is twitchy. Start with low rates for the first flight.', 'Trainers ±12–15° · aerobats ±25–35°'],
    [['flaps'], 'Flaps', 'Inboard trailing-edge surfaces that move down together. They raise maximum lift (lower stall speed) and add drag, for slower, steeper landings. They need extra servos and a channel.'],
    [['aileron expo', 'elevator expo', 'rudder expo'], 'Expo', 'Softens the controls around centre stick while keeping full throw at the ends, so small corrections are gentle. 20–40 % is a good start.'],
    [['low rates'], 'Low rates', 'Reduces all control throws (here to 60 %). Use it for first flights or calm cruising; switch to high rates for aerobatics.'],
    [['stick mode'], 'Stick mode', 'Which stick does what. Mode 2 (most common): left stick throttle and rudder, right stick elevator and aileron. Mode 1 swaps throttle and elevator.'],
    [['invert elevator'], 'Invert elevator', 'Flips the elevator direction, for controllers that report pulling back as negative.'],
    // ---------- motor mount ----------
    [['down-thrust'], 'Down-thrust', 'The motor is tilted so the thrust points a few degrees below the fuselage line. It cancels the nose-up pitch that power causes when the thrust line is below the CG or the prop wash pushes on the tail. Negative values are up-thrust (common on pushers: prop end lower).', 'Tractor trainers 1–4°'],
    [['right-thrust'], 'Right-thrust', 'The motor is turned so the thrust points slightly towards the right wing. It cancels the left swing at full power from the spiral slipstream hitting the fin and from P-factor (for a clockwise prop seen from behind). Negative = left-thrust.', 'Tractor planes 1–3°'],
    [['prop spins'], 'Prop rotation', 'Which way the prop turns, looking at it from behind the plane. It decides which way torque rolls the plane and which way the slipstream and P-factor swing the nose. Standard tractor props spin clockwise seen from behind.'],
    [['motor mount', 'motor mount angles'], 'Motor mount', 'The angle of the motor relative to the fuselage line, set with washers behind the mount screws or a wedge behind the firewall.'],
    [['motor effects'], 'Motor effects', 'When on, the simulator models torque roll, the spiral slipstream on the fin, P-factor and the thrust angles of the mount, so a badly set mount swings and pitches with power. Off = an ideal motor that pushes straight ahead.'],
    [['hole spacing'], 'Mount hole spacing', 'Distance between the screw holes of the motor mount (across the cross mount). The spacer thickness is spacing × tan(angle).'],
    [['down-thrust spacer', 'up-thrust spacer'], 'Down/up-thrust spacer', 'Washers to put behind the screws on the side shown (seen from behind the plane) to tilt the motor by the chosen down- or up-thrust.'],
    [['right-thrust spacer', 'left-thrust spacer'], 'Side-thrust spacer', 'Washers to put behind the screws on the side shown (seen from behind the plane) to turn the motor by the chosen right- or left-thrust.'],
    // ---------- air ----------
    [['air density', 'density', 'air density used'], 'Air density (ρ)', 'Mass of air per cubic metre. Thinner air (hot days, high fields) means less lift and thrust: the stall speed rises and props pull less. 1.225 kg/m³ is the standard at sea level and 15 °C.'],
    [['density altitude'], 'Density altitude', 'The height in the standard atmosphere that has the same density as your field today. A hot day at a low field can "feel" like 1,000 m up: longer take-offs and faster landings.'],
    [['air temperature', 'temperature', 'field temperature'], 'Air temperature', 'Warmer air is less dense: about 1 % less lift and thrust for every 3 °C above 15 °C.'],
    [['field altitude', 'field elevation'], 'Field elevation', 'Height of your flying field above sea level. Air density falls by about 1 % per 100 m.'],
    [['sea-level pressure'], 'Sea-level pressure (QNH)', 'Today\'s air pressure corrected to sea level, from a weather report. Low pressure (stormy weather) means slightly thinner air.', 'Standard 1013 hPa'],
    [['use standard temperature for this altitude'], 'Standard temperature', 'Uses the standard atmosphere temperature for your altitude (15 °C at sea level, 6.5 °C colder per 1,000 m) instead of a measured one.'],
    // ---------- weather (simulator) ----------
    [['weather'], 'Weather preset', 'Sets wind, gusts, turbulence, thermals and sky together. Start calm, then try breeze and gusty to practise landings and crosswinds.'],
    [['mean wind'], 'Mean wind', 'Average wind speed at 10 m height and the direction it blows from. Near the ground it is weaker (wind gradient).'],
    [['direction wander'], 'Wind direction wander', 'How much the wind direction drifts back and forth over time.'],
    [['wind gradient near the ground'], 'Wind gradient', 'How much slower the wind is near the ground than higher up (because of friction with grass and trees). A big gradient can make the plane lose airspeed suddenly as it descends on final.', 'Open field ≈ 0.15 · trees ≈ 0.25'],
    [['gust strength', 'gusts'], 'Gust strength', 'How much stronger than the mean wind each gust gets, at its peak.'],
    [['average time between gusts'], 'Gust interval', 'Average time from one gust to the next. Short intervals make for a bumpy, busy flight.'],
    [['turbulence'], 'Turbulence', 'Continuous small, random changes of the wind, felt as bumps and wobbles. Stronger in strong wind and behind trees.'],
    [['thermals'], 'Thermals', 'Columns of rising warm air. Circling inside one lets a glider climb without the motor; around their edges the air sinks.'],
    [['thermal strength'], 'Thermal strength', 'How fast the air rises in the core of a thermal. To climb, it must be stronger than the plane\'s sink rate.'],
    [['thermal size'], 'Thermal size', 'Radius of the rising core. Small, strong thermals need tight circles; big ones are easier to stay in.'],
    [['number of thermals'], 'Number of thermals', 'How many thermals drift across the field at the same time.'],
    [['sink around thermals'], 'Sink around thermals', 'Strength of the sinking air ring around each thermal, as a share of its lift.'],
    [['cloud cover'], 'Cloud cover', 'How much of the sky is covered. Heavy cloud also darkens the scene.'],
    [['visibility'], 'Visibility', 'How far you can see before haze hides the scenery.'],
    [['wind', 'runway'], 'Wind and runway components', 'Wind speed and direction, split into headwind/tailwind and crosswind along the runway. Take off and land into the wind.'],
    // ---------- simulator setup ----------
    [['assist'], 'Flight assist', 'Beginner: the sticks set a bank and pitch angle and the plane levels itself. Auto-level: it levels when you let go. Off: real behaviour, like a plane with no gyro.'],
    [['instructor'], 'Instructor (buddy box)', 'A virtual instructor who can fly for you. Student switch: you fly only while holding the switch. Auto: the instructor takes over beyond safe limits. Shared: the help grows near the limits.'],
    [['start'], 'Start position', 'Runway take-off, hand launch, or start already flying at 40 m.'],
    [['camera'], 'Camera', 'Pilot view (as from the flight line, the real RC experience), chase, cockpit (FPV) or tower.'],
    [['stall protection'], 'Stall protection', 'Limits up-elevator near the stall so the wing cannot be pulled into a stall. Turn it off to practise real stalls and recoveries.'],
    [['landing gear'], 'Landing gear', 'Tricycle (nose wheel, easy ground handling), taildragger (tail wheel, needs rudder on take-off) or none (hand launch and belly landing).'],
    [['use flight-data calibration'], 'Flight-data calibration', 'Applies correction factors fitted from a real flight log (drag, lift, thrust, current, roll) so the simulator behaves like your actual plane.'],
    [['trees are solid'], 'Solid trees', 'Flying into a tree counts as a crash.'],
    [['quality'], 'Graphics quality', 'Presets for shadows, draw distance and resolution. Lower it if the frame rate drops below about 30 fps.'],
    [['shadows'], 'Shadows', 'Shadow detail. Shadows help judge height near the ground but cost performance.'],
    [['resolution'], 'Render resolution', 'Renders fewer pixels and scales up. 60–85 % is much faster on laptops and phones with little visible loss.'],
    [['draw distance'], 'Draw distance', 'How far away scenery is drawn before it fades into the haze.'],
    [['replay speed'], 'Replay speed', 'Playback speed of the recorded flight.'],
    [['model nose points along', 'model top points along'], '3D model orientation', 'Which axis of the imported 3D file points forward (nose) and up. Different programs use different conventions; pick the one that makes the model fly the right way round.'],
    [['fore / aft offset', 'up / down offset'], '3D model offset', 'Moves the imported 3D model relative to the flight model\'s balance point so the look lines up with the physics.'],
    [['flight data from'], 'Flight data', 'The design whose physics the imported 3D model flies with. The 3D file only provides the look.'],
    [['licence'], 'Licence', 'The terms under which the 3D model may be used. Attribution (CC-BY) licences require you to credit the author when you share it.'],
    [['cruise current'], 'Cruise current', 'Measured battery current in steady level flight, for calibration without a logger.'],
    [['cruise throttle'], 'Cruise throttle', 'The throttle setting that held level flight, for calibration.'],
    [['flight log'], 'Flight log', 'A telemetry or flight-controller log (EdgeTX, INAV/Betaflight, ArduPilot, GPX, IGC) used to calibrate the simulator against the real plane.'],
    // ---------- build ----------
    [['build method', 'build material'], 'Build method and material', 'Foam (Depron, foam board) is quick, cheap and tough; balsa is lighter for its strength and allows real airfoils with ribs, but takes longer and needs covering.'],
    [['foam wing style'], 'Foam wing style', 'KFm step: layered flat sheets that form a step airfoil, very simple. Folded: one sheet folded over a spar for a real cambered section.'],
    [['rib spacing'], 'Rib spacing', 'Distance between ribs on a built-up balsa wing. Closer ribs keep the covering on the airfoil shape but add weight.', 'Typical 50–80 mm'],
    [['sheet thickness'], 'Sheet thickness', 'Thickness of the foam or balsa sheet used for the parts.'],
    [['spar width', 'spar depth'], 'Spar size', 'Cross-section of the main wing spar that carries the bending load. A deeper spar is much stiffer than a wider one.'],
    [['le stock', 'te stock'], 'Leading / trailing-edge stock', 'Balsa strips glued to the front and back of the ribs, then sanded to shape.'],
    [['paper size'], 'Paper size', 'Templates are tiled across pages of this size; tape them together using the crosses.'],
    [['dimension labels'], 'Dimension units', 'Units printed on the templates.'],
    [['material sheets', 'sheet', 'material ≈'], 'Material needed', 'Number of sheets of building material, including about 35 % waste.'],
    [['estimated cost'], 'Estimated cost', 'Sum of the example prices in the parts list. Type your local prices to make it accurate.'],
    [['unit weight', 'weight g'], 'Unit weight', 'Weight of one of this item, in grams.'],
    // ---------- flying style & mission ----------
    [['mission'], 'Mission', 'What the plane is for (trainer, sport, aerobatic, glider, FPV, flying wing). It sets the target stall speed, aspect ratio, power and proportions.'],
    [['flying style'], 'Flying style', 'How you want the plane to fly. It sets the watts per kilogram and the thrust-to-weight ratio the calculator aims for.'],
    [['keep under 250 g'], 'Under 250 g', 'Many countries have lighter rules for drones and models under 250 g. The sizer shrinks the battery if needed to stay below.'],
    [['budget'], 'Budget', 'What you want to spend on parts. The Build page compares its parts list with this.'],
    [['fixed landing gear'], 'Fixed landing gear', 'Wheels and legs add drag (lower top speed and glide ratio) but allow runway take-offs and landings.'],
    [['use my measurements'], 'As-built measurements', 'Uses the weight and balance point you measured on the finished plane instead of the estimates, for every analysis and the simulator.'],
    // ---------- airfoils ----------
    [['flat plate'], 'Flat plate', 'A flat sheet as the wing section. Very simple and fully aerobatic, but low maximum lift and high drag; fine for chuck gliders and profile planes.'],
    [['kfm-2 step'], 'KFm-2 step airfoil', 'A stepped airfoil built from layered foam sheets (Kline–Fogleman). Easy to build, decent lift and very tough.'],
    [['naca 0009'], 'NACA 0009', 'A thin symmetric section (9 % thick). Same behaviour upright and inverted, so it suits tails and fast aerobatics.'],
    [['naca 0012'], 'NACA 0012', 'A 12 % symmetric section: aerobatic, flies the same inverted, gentle stall.'],
    [['naca 2412'], 'NACA 2412', 'A 12 % section with 2 % camber: a good all-round sport airfoil with moderate lift and low drag.'],
    [['naca 4412'], 'NACA 4412', 'A 12 % section with 4 % camber: high lift for slow flyers, trainers and payload planes.'],
    [['naca 6409'], 'NACA 6409', 'A thin, highly cambered section: excellent lift at low speed for gliders and slow thermal flying.'],
    [['clark y'], 'Clark Y', 'The classic flat-bottomed airfoil: easy to build on a flat board, gentle stall, good lift. Ideal for trainers.'],
    [['weight', 'weight g'], 'Weight', 'Mass in grams. For a part it is the weight of that item; for the whole plane see all-up weight. Every gram adds to the stall speed and the power needed.'],
    [['wing'], 'Wing', 'The main lifting surface: its span, chord, sweep and dihedral set the area, aspect ratio and stall speed.'],
    [['motor & prop'], 'Motor and prop', 'Optional: enter your motor\'s KV and prop size to check them. Leave them empty and the calculator suggests a KV and a prop shortlist that suit the plane.'],
    [['reference motor'], 'Reference motor', 'A well-known motor of the right size and KV, given as an example. Any motor with similar size, KV and current rating will do.'],
    [['props'], 'Prop shortlist', 'Props that load the motor to about the target power at the chosen KV and cells, with a sensible pitch speed for your cruise speed.'],
    [['__prop-size'], 'Prop size', 'Diameter × pitch in inches: an 8×3.8 is 8 in across and would screw forward 3.8 in per turn. Bigger diameter = more thrust and load; more pitch = more speed.'],
    [['__motor-class'], 'Motor size code', 'Brushless motor sizes are usually stator diameter and height in mm: a 2204 has a 22 mm × 4 mm stator. Bigger stators handle more power; "Park 300" style names are E-flite\'s size classes (≈ 300 = up to about 100 W).'],
    [['aircraft'], 'Aircraft', 'Which plane to fly: a built-in model, your current Designer design, a saved design, or an imported 3D model with its flight data.'],
    [['time'], 'Time speed', 'Real time or slow motion. Slow motion is great for learning landings and aerobatic manoeuvres.'],
    [['show the ideal path in lessons'], 'Ideal path', 'Draws the line a good pilot would fly through the lesson, as a cyan ribbon in the 3D view.'],
    [['auto-zoom in pilot view'], 'Auto-zoom', 'Zooms the pilot-view camera as the plane flies away so it stays a useful size on screen, like your eyes focusing on it.'],
    [['smoke trail'], 'Smoke trail', 'Draws a trail behind the plane: handy to see your line in circuits, loops and landings.'],
    [['show thermals'], 'Show thermals', 'Draws the thermals as faint columns so you can learn what they look like and how to centre in them. Real thermals are invisible.'],
    [['on-screen sticks'], 'On-screen sticks', 'Touch or mouse sticks on the screen, for flying without a controller.'],
    [['throttle on'], 'Throttle during the test', 'Whether the motor was running during this measured segment (manual calibration entry).'],
    [['360° photo'], '360° photo field', 'Use an equirectangular (360°) photo of your own field as the background, viewed from the pilot position.'],
    [['scenery file', 'hide the built-in trees'], 'Custom scenery', 'Load a glTF/GLB or OBJ model of a field, in metres, with the ground at height 0. Optionally hide the built-in trees.'],
    [['link span & wing area to the calculator'], 'Link to the calculator', 'Keeps the diagram\'s span and wing area in sync with the calculator inputs, so the drawing always matches the numbers.'],
    [['gentle trainer', 'sport', 'aerobatic', 'powered glider'], 'Flying style', 'Each style sets the power (watts per kilogram) and thrust-to-weight the calculator aims for: gentle trainers need the least, aerobats the most.'],
    [['choose an airfoil'], 'Airfoil choice', 'Pick the wing section. Cambered sections lift well at low speed; symmetric ones fly the same inverted; reflexed ones suit flying wings.'],
    [['battery current'], 'Battery current at full throttle', 'Amps drawn from the battery with the throttle wide open: electrical power ÷ loaded pack voltage. The battery, ESC and motor must all handle it.'],
    [['required c rating'], 'Required C rating', 'Full-throttle current ÷ capacity in Ah, plus a margin. Buy a battery rated at least this high (continuous), or it sags, heats up and ages quickly.'],
    [['flight time, full throttle', 'flight time at 50% throttle'], 'Flight time', 'Usable capacity ÷ current. Full throttle is the worst case; at half throttle the current drops a lot (power falls roughly with RPM³), so flights last much longer. Real flights are a mix.'],
    [['loaded rpm'], 'Loaded RPM', 'Prop speed under load: KV × loaded voltage × the RPM load factor. It sets the pitch speed and the power the prop absorbs.'],
    [['prop power absorbed'], 'Prop power absorbed', 'Power the prop takes at the loaded RPM: P = Cp·ρ·n³·D⁵. It should be close to the target power; much more overloads the motor and battery.'],
    [['thrust-to-weight'], 'Thrust-to-weight ratio', 'Static thrust ÷ weight. Below 0.5 the plane climbs slowly and needs a runway; around 1 it can climb steeply; above 1 it can hang on the prop and go vertical.', 'Trainers 0.5–0.8 · sport ≈ 1 · 3D 1.5+'],
    [['motor weight & rating'], 'Motor weight and rating', 'Roughly how heavy a motor that handles the target power is, and the power and current rating to look for. Pick a motor rated about 20–30 % above the target.'],
    [['esc size'], 'ESC size', 'Recommended speed-controller rating: about 1.3–1.5 × the full-throttle current, rounded up to a common size.'],
    [['receiver channels'], 'Receiver channels', 'How many channels you need: throttle plus one per control function (aileron, elevator, rudder, flaps). Ailerons on two servos can share one channel with a Y-lead or use two.'],
    [['prop shortlist'], 'Prop shortlist', 'Props that load the motor to about the target power at the chosen KV and cells, with a sensible pitch speed for your cruise speed.'],
    [['reference motor classes'], 'Reference motor classes', 'Well-known motor families that cover the needed power, as a starting point when shopping.'],
    [['weight breakdown'], 'Weight breakdown', 'Estimated weight of each part, from the material, sizes and electronics. Weigh your real parts and enter them for a better analysis.'],
    [['where to balance'], 'Where to balance', 'The CG scale: the safe range, the recommended point, your current CG and the neutral point, as % of the MAC and in mm behind the wing root leading edge.'],
    [['as built'], 'As built (measured)', 'Enter the weight and balance point measured on the finished plane; every analysis and the simulator then use the real numbers.'],
    [['multi-panel wing cg calculator'], 'Multi-panel wing', 'For wings with several straight panels: works out the overall area, MAC and CG position from each panel\'s span, chord and sweep.'],
    [['spanwise lift distribution at cruise'], 'Spanwise lift distribution', 'How the lift is spread from root to tip at cruise (lifting-line theory), compared with the ideal ellipse. Close to elliptic = least induced drag.'],
    [['local cl ÷ clmax at the onset of stall'], 'Where the wing stalls first', 'How close each part of the span is to its maximum lift as the wing approaches the stall. The peak shows where the stall starts: near the root is safe, near the tips can drop a wing.'],
    [['thrust available vs drag'], 'Thrust vs drag', 'The thrust the prop gives at each airspeed against the plane\'s drag. Where they cross is the top speed; the gap between them is what is available for climbing.'],
    [['electrical power required'], 'Power required', 'Electrical power needed for level flight at each speed. The bottom of the curve is the most efficient (longest-endurance) speed.'],
    [['glide polar'], 'Glide polar', 'Sink rate against airspeed with the motor off. The lowest point is the minimum sink; a line from the origin touching the curve gives the best glide.'],
    [['flight logs & calibration'], 'Flight logs and calibration', 'Import a real flight log to fit correction factors (drag, lift, thrust, current, roll) so the predictions match your plane.'],
    [['best matches'], 'Best power-system matches', 'Motor and prop combinations from the database that meet the target power and current limits, ranked by fit.'],
    [['servos'], 'Servos', 'Number and size of servos needed for the control surfaces. Micro servos (4–9 g) are enough for foam planes under about 500 g.'],
    [['reflex'], 'Reflex airfoil', 'A section whose trailing edge curves up. It makes the wing stable in pitch on its own, which flying wings need.'],
  ];

  const norm = s => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[:?≈]/g, ' ').replace(/\s+/g, ' ').trim();
  const MAP = new Map();
  const KEY_OF = new Map();
  G.forEach(([keys, title, text, typical]) => { const e = { title, text, typical }; keys.forEach(k => { const n = norm(k); if (!MAP.has(n)) MAP.set(n, e); if (!KEY_OF.has(e)) KEY_OF.set(e, n); }); });
  const lookup = s => { const n = norm(s); if (!n || n.length > 60) return null; if (MAP.has(n)) return MAP.get(n);
    for (const pre of ['motor effects', 'prop spins', 'down-thrust spacer', 'right-thrust spacer', 'up-thrust spacer', 'left-thrust spacer', 'battery']) if (n.startsWith(pre) && MAP.has(pre)) return MAP.get(pre);
    const m = /^(naca \d{4}|kfm-2 step|flat plate|clark y|gentle trainer|powered glider|aerobatic|sport)/.exec(n); if (m && MAP.has(m[1])) return MAP.get(m[1]);
    if (/^\d+(\.\d+)?\s*[×x]\s*\d+(\.\d+)?$/.test(n)) return MAP.get('__prop-size');
    if (/^(\d{4}-class|(e-flite )?park \d{3})/.test(n)) return MAP.get('__motor-class'); return null; };

  /* ---------- shared tooltip ---------- */
  let tip = null, anchor = null;
  function ensureTip(){ if (tip) return tip; tip = document.createElement('div'); tip.id = 'rc-tip'; tip.className = 'rc-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; document.body.appendChild(tip); return tip; }
  const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  function show(btn){
    const e = MAP.get(btn.dataset.infoKey); if (!e) return; const t = ensureTip(); anchor = btn;
    t.innerHTML = `<b>${escH(e.title)}</b><span>${escH(e.text)}</span>${e.typical ? `<small>${escH(e.typical)}</small>` : ''}`; t.hidden = false; btn.setAttribute('aria-describedby', 'rc-tip');
    const r = btn.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 16); t.style.maxWidth = w + 'px';
    const tw = t.offsetWidth, th = t.offsetHeight; let x = r.left + r.width / 2 - tw / 2, y = r.bottom + 8;
    x = Math.max(8, Math.min(window.innerWidth - tw - 8, x)); if (y + th > window.innerHeight - 8) y = Math.max(8, r.top - th - 8);
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hide(){ if (tip) tip.hidden = true; if (anchor) anchor.removeAttribute('aria-describedby'); anchor = null; }

  /* ---------- attach "i" buttons ---------- */
  const SKIP = 'nav, header, footer, .hud, svg, #rc-tip, .rc-tip, button, .btn, select, option, .no-info, .page-thumb, .dev, .toast, .seg';
  function makeBtn(key, title){ const b = document.createElement('span'); b.className = 'info-i'; b.tabIndex = 0; b.setAttribute('role', 'button'); b.dataset.infoKey = key; b.setAttribute('aria-label', `What is ${title}?`); b.textContent = 'i'; return b; }
  const textUntil = (el, stopSel) => { let s = '', last = null; for (const n of el.childNodes) { if (n.nodeType === 1 && n.matches(stopSel)) break; if (n.nodeType === 1 && n.classList.contains('info-i')) return { s:'', last:null }; s += n.textContent; last = n; } return { s, last }; };
  const STOP = 'input, select, textarea, output, .u, .tag, a, .help, small, .hint, br, .info-i, button, svg, ul, ol, div, p, table';
  /** Leading label text of an element (skipping a leading checkbox/radio) and the node to put the "i" after. */
  function extract(el){
    let s = '', last = null;
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { s += n.textContent; if (n.textContent.trim()) last = n; continue; }
      if (n.nodeType !== 1 || n.matches('.ico, .num')) continue;
      if (/^(INPUT|TEXTAREA)$/.test(n.tagName) && !s.trim()) continue;
      if (n.matches(STOP)) break;
      if (/^(SPAN|B|STRONG|SUB|SUP|EM|ABBR|I)$/.test(n.tagName)) { if (n.querySelector(STOP)) { if (!s.trim()) { const r = extract(n); return r; } break; } s += n.textContent; last = n; continue; }
      break;
    }
    if (!s.trim()) { const b = el.querySelector('b, strong'); if (b && !b.closest('.tag')) { s = b.textContent; last = b; } }
    return { s, last };
  }
  function attach(el, kind){
    if (el.dataset.infoDone || el.closest(SKIP) || el.querySelector(':scope > .info-i')) return; el.dataset.infoDone = '1';
    let text, after;
    if (kind === 'pill') { const r = textUntil(el, 'b, strong'); text = r.s; after = r.last; }
    else if (kind === 'chip') { const b = el.querySelector('b'); if (!b) return; text = b.textContent; after = b; }
    else { const r = extract(el); text = r.s; after = r.last; }
    const key = norm(text), e = lookup(text); if (!e || !after) return;
    const k = MAP.has(key) ? key : KEY_OF.get(e);
    after.parentNode.insertBefore(makeBtn(k, e.title), after.nextSibling);
  }
  const TARGETS = [['label', 'label'], ['.stat .lbl', 'stat'], ['th[scope=row]', 'th'], ['th[scope=col]', 'col'], ['legend', 'legend'], ['.pill', 'pill'], ['.chip', 'chip'], ['.card > h3', 'h3'], ['.card-head h3', 'h3'], ['.sub-h', 'h3']];
  function scan(root){ if (!root || !root.querySelectorAll) return; for (const [sel, kind] of TARGETS) { if (root.matches && root.matches(sel)) attach(root, kind); root.querySelectorAll(sel).forEach(el => attach(el, kind)); } }

  let pending = new Set(), raf = 0;
  const flush = () => { raf = 0; const roots = [...pending]; pending = new Set(); roots.forEach(scan); if (anchor && !anchor.isConnected) hide(); };
  function start(){
    scan(document.body);
    new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach(n => { if (n.nodeType === 1 && !n.closest('.hud, #rc-tip')) pending.add(n); }); if (pending.size && !raf) raf = requestAnimationFrame(flush); })
      .observe(document.body, { childList:true, subtree:true });
    const on = (ev, fn) => document.addEventListener(ev, e => { const b = e.target.closest && e.target.closest('.info-i'); fn(e, b); }, true);
    on('mouseover', (e, b) => { if (b) show(b); });
    on('mouseout', (e, b) => { if (b && !(e.relatedTarget && b.contains(e.relatedTarget))) hide(); });
    on('focusin', (e, b) => { if (b) show(b); });
    on('focusout', (e, b) => { if (b) hide(); });
    on('click', (e, b) => { if (!b) { if (anchor && !(e.target.closest && e.target.closest('#rc-tip'))) hide(); return; } e.preventDefault(); e.stopPropagation(); if (anchor === b) hide(); else show(b); }); // inside a <label> this must not toggle the control
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && anchor) { const a = anchor; hide(); a.blur(); } if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('info-i')) { e.preventDefault(); anchor === e.target ? hide() : show(e.target); } }, true);
    window.addEventListener('scroll', () => { if (anchor) show(anchor); }, true); window.addEventListener('resize', hide);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  const list = () => { const seen = new Set(); return G.filter(e => !e[0][0].startsWith('__')).filter(e => { if (seen.has(e[1])) return false; seen.add(e[1]); return true; }).map(([keys, title, text, typical]) => ({ keys, title, text, typical })); };
  window.RCInfo = { lookup, norm, entries:G.length, scan, list };
})();
