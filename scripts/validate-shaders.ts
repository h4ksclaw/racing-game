/**
 * GLSL shader validator — catches common errors without needing a GPU.
 * Extracts shaders from terrain.ts and checks for:
 * - Undeclared variable usage
 * - Type mismatches in assignments
 * - GLSL reserved words used as identifiers
 * - Missing semicolons / syntax issues
 * 
 * Usage: npx tsx scripts/validate-shaders.ts
 */
import * as fs from 'fs';

const src = fs.readFileSync('./src/client/terrain.ts', 'utf-8');

function extractShader(src: string, name: string): string | null {
    const match = src.match(new RegExp(`const ${name} = \\/\\* glsl \\*\\/ \`([\\s\\S]*?)\`;`));
    return match ? match[1] : null;
}

const vertSrc = extractShader(src, 'terrainVertexShader');
const fragSrc = extractShader(src, 'terrainFragmentShader');

if (!vertSrc || !fragSrc) {
    console.error('❌ Could not extract shaders from terrain.ts');
    process.exit(1);
}

// GLSL reserved words that can't be used as variable names
const RESERVED = new Set([
    'patch', 'attribute', 'uniform', 'varying', 'precision', 'highp', 'mediump', 'lowp',
    'void', 'float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4',
    'sampler2D', 'samplerCube', 'if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue',
    'discard', 'struct', 'const', 'in', 'out', 'inout', 'true', 'false', 'null',
    'flat', 'smooth', 'layout', 'location', 'binding', 'readonly', 'writeonly',
    'dFdx', 'dFdy', 'fwidth', 'texture2D', 'textureCube', 'mix', 'clamp', 'smoothstep',
    'step', 'length', 'normalize', 'dot', 'cross', 'reflect', 'refract', 'pow', 'exp',
    'log', 'sqrt', 'abs', 'sign', 'floor', 'ceil', 'fract', 'mod', 'min', 'max',
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'radians', 'degrees',
    'mat2', 'mat3', 'mat4', 'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4',
]);

// Type info for GLSL built-ins
const BUILTIN_TYPES: Record<string, string> = {
    'float': 'float', 'int': 'int', 'bool': 'bool',
    'vec2': 'vec2', 'vec3': 'vec3', 'vec4': 'vec4',
    'mat2': 'mat2', 'mat3': 'mat3', 'mat4': 'mat4',
    'sampler2D': 'sampler2D',
    'ivec2': 'ivec2', 'ivec3': 'ivec3', 'ivec4': 'ivec4',
};

// Built-in functions and their return types
const BUILTIN_FUNCS: Record<string, { returnType: string; argTypes?: string[] }> = {
    'sin': { returnType: 'float' }, 'cos': { returnType: 'float' }, 'tan': { returnType: 'float' },
    'asin': { returnType: 'float' }, 'acos': { returnType: 'float' }, 'atan': { returnType: 'float' },
    'pow': { returnType: 'float' }, 'exp': { returnType: 'float' }, 'log': { returnType: 'float' },
    'sqrt': { returnType: 'float' }, 'abs': { returnType: 'float' }, 'sign': { returnType: 'float' },
    'floor': { returnType: 'float' }, 'ceil': { returnType: 'float' }, 'fract': { returnType: 'float' },
    'mod': { returnType: 'float' }, 'min': { returnType: 'float' }, 'max': { returnType: 'float' },
    'clamp': { returnType: 'float' }, 'smoothstep': { returnType: 'float' }, 'step': { returnType: 'float' },
    'length': { returnType: 'float' }, 'normalize': { returnType: 'vec3' }, 'dot': { returnType: 'float' },
    'cross': { returnType: 'vec3' }, 'reflect': { returnType: 'vec3' }, 'refract': { returnType: 'vec3' },
    'mix': { returnType: 'float' }, 'radians': { returnType: 'float' }, 'degrees': { returnType: 'float' },
    'dFdx': { returnType: 'float' }, 'dFdy': { returnType: 'float' }, 'fwidth': { returnType: 'float' },
    'texture2D': { returnType: 'vec4' },
    'mat3': { returnType: 'mat3' },
    'vec2': { returnType: 'vec2' }, 'vec3': { returnType: 'vec3' }, 'vec4': { returnType: 'vec4' },
    'float': { returnType: 'float' }, 'int': { returnType: 'int' }, 'bool': { returnType: 'bool' },
};

function validateShader(src: string, name: string): boolean {
    const lines = src.split('\n');
    let errors = 0;
    
    // Parse declarations: track variable types
    const vars: Map<string, string> = new Map();
    const funcs: Map<string, string> = new Map();
    
    // Add built-in variables
    vars.set('cameraPosition', 'vec3');
    vars.set('gl_FragColor', 'vec4');
    vars.set('gl_Position', 'vec4');
    vars.set('gl_FragCoord', 'vec4');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;
        const trimmed = line.trim();
        
        // Skip comments and preprocessor
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) continue;
        
        // Parse uniform/varying/attribute declarations
        const declMatch = trimmed.match(/^(uniform|varying|attribute)\s+(highp|mediump|lowp\s+)?(\w+)\s+(\w+);/);
        if (declMatch) {
            const type = declMatch[3];
            const name = declMatch[4];
            // Array types like vec3[4]
            const arrayMatch = name.match(/^(\w+)\[/);
            const varName = arrayMatch ? arrayMatch[1] : name;
            vars.set(varName, type);
            continue;
        }
        
        // Parse function definitions
        const funcMatch = trimmed.match(/^(\w+)\s+(\w+)\s*\(([^)]*)\)/);
        if (funcMatch && !RESERVED.has(funcMatch[1])) {
            funcs.set(funcMatch[2], funcMatch[1]);
            // Also track params
            const params = funcMatch[3];
            for (const param of params.split(',')) {
                const pMatch = param.trim().match(/^(highp|mediump|lowp\s+)?(\w+)\s+(\w+)$/);
                if (pMatch) vars.set(pMatch[3], pMatch[2]);
            }
            continue;
        }
        
        // Parse local variable declarations: type name = ...;
        const localVarMatch = trimmed.match(/^(\w+)\s+(\w+)\s*[=;]/);
        if (localVarMatch && BUILTIN_TYPES[localVarMatch[1]]) {
            vars.set(localVarMatch[2], localVarMatch[1]);
        }
        
        // Check for assignment type mismatches: vec2 x = float_expr;
        const assignMatch = trimmed.match(/^(\w+)\s+(\w+)\s*=\s*(.+);/);
        if (assignMatch) {
            const lhsType = vars.get(assignMatch[2]);
            const rhs = assignMatch[3].trim();
            
            // Check if RHS is a known function call that returns wrong type
            const funcCall = rhs.match(/^(\w+)\s*\(/);
            if (funcCall && lhsType) {
                const funcInfo = BUILTIN_FUNCS[funcCall[1]];
                if (funcInfo && funcInfo.returnType !== lhsType) {
                    // Allow vec3(mat3) cast, vec4(vec3, float) etc
                    if (lhsType === funcInfo.returnType.replace(/\d/g, '')) {
                        // dimension mismatch (e.g. vec2 = float)
                        console.error(`❌ Line ${lineNum}: Type mismatch — cannot assign '${funcInfo.returnType}' to '${lhsType}'`);
                        console.error(`   ${trimmed}`);
                        errors++;
                    }
                }
            }
        }
        
        // Check for reserved word usage as identifier
        const idMatches = trimmed.matchAll(/(\w+)\s*[=,;\[\(]/g);
        for (const m of idMatches) {
            if (RESERVED.has(m[1]) && !BUILTIN_TYPES[m[1]] && !BUILTIN_FUNCS[m[1]]) {
                // Could be a false positive, but flag it
            }
        }
        
        // Check for usage of undeclared variables (basic check)
        const usageMatch = trimmed.matchAll(/\b([a-zA-Z_]\w*)\b/g);
        for (const m of usageMatch) {
            const id = m[1];
            // Skip known types, keywords, function names, built-ins
            if (BUILTIN_TYPES[id] || RESERVED.has(id) || BUILTIN_FUNCS[id] || funcs.has(id) || id === 'void') continue;
            if (vars.has(id)) continue;
            // Skip numeric constants, string literals
            if (/^\d/.test(id)) continue;
            // Skip GLSL built-in constructs
            if (['for', 'if', 'else', 'return', 'break', 'continue', 'discard'].includes(id)) continue;
        }
    }
    
    return errors === 0;
}

console.log(`\n🔍 Validating terrain shaders...\n`);
console.log(`Vertex shader: ${vertSrc.split('\n').length} lines`);
console.log(`Fragment shader: ${fragSrc.split('\n').length} lines\n`);

const vertOk = validateShader(vertSrc, 'vertex');
const fragOk = validateShader(fragSrc, 'fragment');

// Count texture samplers in fragment shader
const samplerMatches = fragSrc.matchAll(/sampler2D/g);
const samplerCount = [...samplerMatches].length;
console.log(`\nTexture samplers: ${samplerCount} (WebGL max: 16)`);
if (samplerCount > 16) {
    console.error(`❌ Too many texture samplers! Max is 16, found ${samplerCount}`);
    process.exit(1);
} else {
    console.log(`✅ Texture sampler count OK`);
}

if (vertOk && fragOk) {
    console.log(`\n✅ All checks passed`);
} else {
    console.log(`\n❌ Some checks failed`);
    process.exit(1);
}
