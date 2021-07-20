# Upgrade notes for @rushstack/heft

### Heft 0.35.0

This release of Heft removed the Sass plugin from the `@rushstack/heft` package
and moved it into its own package (`@rushstack/heft-sass-plugin`). To reenable
Sass support in a project, include a dependency on `@rushstack/heft-sass-plugin`
and add the following option to the project's `config/heft.json` file:

```JSON
{
  "heftPlugins": [
    {
      "plugin": "@rushstack/heft-sass-plugin"
    }
  ]
}
```

If you are using `@rushstack/heft-web-rig`, upgrading the rig package will bring
Sass support automatically.

### Heft 0.32.0

Breaking change for Jest:  This release of Heft enables rig support for Jest config files.
It also reduces Heft's installation footprint by removing the Jest plugin from `@rushstack/heft`
and moving it to its own package `@rushstack/heft-jest-plugin`.  As a result, Jest is now
disabled by default.

To reenable Jest support for your project, follow these steps:

1. If you are using `@rushstack/heft-node-rig` or `@rushstack/heft-web-rig`, the Jest
   plugin is already enabled.  Skip to step 4.

2. Add the `@rushstack/heft-jest-plugin` dependency to your project's **package.json** file.

3. Load the plugin by adding this setting to your `config/heft.json` file:

   ```js
   {
     "heftPlugins": [
       {
         "plugin": "@rushstack/heft-jest-plugin"
       }
     ]
   }
   ```

4. Update your `config/jest.config.json` file, replacing the `preset` field with
   an equivalent `extends` field.  This enables Heft to perform module resolution
   with support for rigs.

   For example, this setting...

   ```js
   {
     "preset": "./node_modules/@rushstack/heft/includes/jest-shared.config.json"
   }
   ```

   ...should be changed to this:

   ```js
   {
     "extends": "@rushstack/heft-jest-plugin/includes/jest-shared.config.json"
   }
   ```

   As another example, if you are using a rig, then this...

   ```js
   {
     "preset": "./node_modules/@rushstack/heft-web-rig/profiles/library/config/jest.config.json"
   }
   ```

   ...should be changed to this:

   ```js
   {
     "extends": "@rushstack/heft-web-rig/profiles/library/config/jest.config.json"
   }
   ```

This `extends` field is a Heft-specific enhancement that will not work if the Jest command line
is invoked without Heft.  (Doing so was not generally useful; in our configuration Jest relies
on Heft to invoke the compiler and any other preprocessing steps.)

If for some reason your `jest.config.json` needs to be directly readable by Jest, the
`disableConfigurationModuleResolution` setting can be used to restore the old behavior.
For example:

   ```js
   {
     "heftPlugins": [
       {
         "plugin": "@rushstack/heft-jest-plugin",
         "options": {
           // (Not recommended) Disable Heft's support for rigs and the "extends" field
           "disableConfigurationModuleResolution": true
         }
       }
     ]
   }
   ```


### Heft 0.26.0

This release of Heft removed the Webpack plugins from the `@rushstack/heft` package
and moved them into their own package (`@rushstack/heft-webpack4-plugin`). To reenable
Webpack support in a project, include a dependency on `@rushstack/heft-webpack4-plugin`
and add the following option to the project's `config/heft.json` file:

```JSON
{
  "heftPlugins": [
    {
      "plugin": "@rushstack/heft-webpack4-plugin"
    }
  ]
}
```

If you are using `@rushstack/heft-web-rig`, upgrading the rig package will bring
Webpack support automatically.

### Heft 0.14.0

This release of Heft consolidated several config files and introduced support
for [rig packages](https://www.npmjs.com/package/@rushstack/rig-package).

The major changes were:

- `.heft/typescript.json` has moved to a different folder `config/typescript.json`.  Going forward
  config files will no longer be stored in the hidden `.heft` folder.

- The `emitFolderNameForJest` setting in `typescript.json` has been renamed to `emitFolderNameForTests`

- `clean.json` has been removed.  If your file previously looked like this:

  **.heft/clean.json** (OLD)
  ```js
  {
    "$schema": "https://developer.microsoft.com/json-schemas/heft/clean.schema.json",

    "pathsToDelete": ["dist", "lib", "temp"]
  }
  ```

  ...these settings are now specified in the new `heft.json` file like this:

  **config/heft.json** (NEW)
  ```js
  {
    "$schema": "https://developer.microsoft.com/json-schemas/heft/heft.schema.json",

    "eventActions": [
      {
        "actionKind": "deleteGlobs",
        "heftEvent": "clean",
        "actionId": "defaultClean",
        "globsToDelete": ["dist", "lib", "temp"]
      }
    ]

    . . .
  }
  ```

- `copy-static-assets.json` has been removed.  If your file previously looked like this:

  **.heft/copy-static-assets.json** (OLD)
  ```js
  {
    "$schema": "https://developer.microsoft.com/json-schemas/heft/copy-static-assets.schema.json",
    "fileExtensions": [".css", ".png"]
  }
  ```

  ...these settings are now specified in the `typescript.json` file like this:

  **config/typescript.json** (NEW)
  ```js
  {
    "$schema": "https://developer.microsoft.com/json-schemas/heft/typescript.schema.json",

     . . .

    "staticAssetsToCopy": {
      "fileExtensions": [".css", ".png"]
    }
  }
  ```

- `plugins.json` has been removed.  If your file previously looked like this:

  **.heft/plugins.json** (OLD)
  ```js
  {
    "$schema": "https://developer.microsoft.com/json-schemas/heft/plugins.schema.json",

    "plugins": [
      {
        "plugin": "path/to/my-plugin",
      }
    ]
  }

  ```

  ...these settings are now specified in the `heft.json` file like this:

  **config/heft.json** (NEW)
  ```js
  {
    "$schema": "https://developer.microsoft.com/json-schemas/heft/typescript.schema.json",

     . . .

    "heftPlugins": [
      {
        "plugin": "path/to/my-plugin",
      }
    ]
  }
  ```

Complete documentation for Heft config file formats can be found on
the [project website](https://rushstack.io/pages/heft/overview/).
