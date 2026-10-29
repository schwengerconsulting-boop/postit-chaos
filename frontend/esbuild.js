require("dotenv").config()

const sass = require("sass")
const path = require("path")
const fs = require("fs")
const esbuild = require("esbuild")
const chokidar = require("chokidar")

const mode = process.argv[2]

if (!mode) {
    throw Error("Specify 'build' or 'watch' as argument")
}
const stubImportsPlugin = (paths) => {
    return {
        name: "stub-imports",
        setup(build) {
            const regex = new RegExp(`^(${paths.join("|")})\$`)
            build.onResolve({ filter: regex }, (args) => ({
                path: args.path,
                namespace: "stub-imports-namespace",
            }))
            build.onLoad({ filter: /.*/, namespace: "stub-imports-namespace" }, () => ({
                contents: "{}",
                loader: "json",
            }))
        },
    }
}

const sassPlugin = {
    name: "sass",
    setup(build) {
        build.onResolve({ filter: /(\.svg|\.png)$/ }, (args) => {
            return {
                path: path.resolve(CWD, "src", args.path),
            }
        })
        build.onResolve({ filter: /\.scss$/ }, (args) => {
            return {
                path: path.resolve(args.resolveDir, args.path),
                namespace: "sass",
            }
        })
        build.onLoad({ filter: /.*/, namespace: "sass" }, (args) => {
            let compiled = sass.compile(args.path, { quietDeps: true, silenceDeprecations: ["import", "global-builtin", "color-functions"] })
            return {
                contents: compiled.css,
                loader: "css",
            }
        })
    },
}

// harmaja 0.24 hat ein kaputtes "exports"-Feld (Ziele ohne "./"); moderne Bundler lehnen es ab.
const harmajaPlugin = {
    name: "harmaja-exports-fix",
    setup(build) {
        const root = [path.join(__dirname, "node_modules/harmaja"), path.join(__dirname, "../node_modules/harmaja")].find((p) => fs.existsSync(p))
        build.onResolve({ filter: /^harmaja(\/.*)?$/ }, (args) => {
            const sub = args.path === "harmaja" ? "lonna/index.js" : args.path.slice("harmaja/".length)
            const candidates = [sub, sub + ".js", sub + "/index.js"].map((c) => path.join(root, c))
            const found = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile())
            return found ? { path: found } : undefined
        })
    },
}

const CWD = process.cwd()
const DIST_FOLDER = path.resolve(CWD, "dist")

const envFallback = (envVar, fb = null) => (envVar ? `"${envVar}"` : `${fb}`)

async function build() {
    if (fs.existsSync(DIST_FOLDER)) fs.rmSync(DIST_FOLDER, { recursive: true, force: true })
    const randomString = Math.random().toString(36).slice(2)
    const outfile = path.resolve(CWD, `dist/bundle.${randomString}.js`)
    const now = Date.now()
    await esbuild.build({
        entryPoints: [path.resolve(CWD, "src", "index.tsx")],
        bundle: true,
        minify: mode !== "watch",
        outfile,
        metafile: true,
        sourcemap: true,
        platform: "browser",
        plugins: [harmajaPlugin, sassPlugin, stubImportsPlugin(["path"])],
        loader: { ".png": "file", ".svg": "file" },
        define: {
            "process.env.NODE_ENV": envFallback(process.env.NODE_ENV, `"development"`),
        },
    })

    fs.writeFileSync(
        path.resolve(CWD, "dist/index.html"),
        fs
            .readFileSync(path.resolve(CWD, "index.tmpl.html"), "utf8")
            .replace("JAVASCRIPT_BUNDLE", `/bundle.${randomString}.js`)
            .replace("CSS_BUNDLE", `/bundle.${randomString}.css`),
    )
    console.log(`Frontend build done, took ${Date.now() - now} ms`)
}

if (mode === "build") {
    build().catch((e) => !console.error(e) && process.exit(1))
} else if (mode === "watch") {
    build()
        .catch((e) => console.error(e))
        .then(() => {
            chokidar
                .watch([path.resolve(CWD, "src"), path.resolve(CWD, "../common/src")], { ignoreInitial: true })
                .on("all", (...arg) => {
                    build().catch((e) => console.error(e))
                })
        })
} else {
    throw Error("Unknown mode: " + mode)
}
