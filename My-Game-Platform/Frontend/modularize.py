import os
import re

base_dir = r"d:\CODING\ANTIGRAVITY 2.0\My-App-2\My-Game-Platform\Frontend"

def modularize_html(filepath, target_js_file, replacements=None):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # We'll use regex to find all <script>...</script> blocks without a src attribute
    # except the one containing 'window.GD_OPTIONS' because that's inline config.
    script_pattern = re.compile(r'<script(?!\s+src)[^>]*>(.*?)</script>', re.DOTALL)
    
    scripts = script_pattern.findall(content)
    
    extracted_js = []
    new_content = content
    
    for script in scripts:
        if 'window.GD_OPTIONS' in script:
            continue
        
        extracted_js.append(script.strip())
        
        # Replace the first exact match of this script block with nothing
        full_script_block = f"<script>{script}</script>"
        if full_script_block in new_content:
            new_content = new_content.replace(full_script_block, "")
        else:
            # Maybe it has some attributes or spaces
            match = re.search(r'<script[^>]*>' + re.escape(script) + r'</script>', new_content)
            if match:
                new_content = new_content[:match.start()] + new_content[match.end():]

    # Combine extracted js
    final_js = "\n\n".join(extracted_js)
    
    # Apply asset replacements if any
    if replacements:
        for old, new in replacements.items():
            final_js = final_js.replace(old, new)
            
    # Write to game.js
    js_path = os.path.join(os.path.dirname(filepath), target_js_file)
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write(final_js)
        
    # Insert <script src="game.js"></script> before </body>
    if '</body>' in new_content:
        new_content = new_content.replace('</body>', f'    <script src="{target_js_file}"></script>\n</body>')
    else:
        new_content += f'\n<script src="{target_js_file}"></script>'
        
    # Write modified html
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)
        
    print(f"Modularized {filepath} -> {js_path}")

# Game 1: Balloon Pop
modularize_html(
    os.path.join(base_dir, "game.html"),
    "game.js"
)

asset_replacements = {
    "Acid Slimy": "Acid-Slimy",
    "Core Detonator": "Core-Detonator",
    "Crystal Cutter": "Crystal-Cutter",
    "Dark Warrior": "Dark-Warrior",
    "Fire Demon": "Fire-Demon",
    "Freeze Ghost": "Freeze-Ghost",
    "Wasp Shooter": "Wasp-Shooter"
}

# Game 2: Arcane Survivors
modularize_html(
    os.path.join(base_dir, "arcane-survivors", "index.html"),
    "game.js",
    asset_replacements
)

# Game 3: Neon Survivors
modularize_html(
    os.path.join(base_dir, "neon-survivors", "index.html"),
    "game.js",
    asset_replacements
)
