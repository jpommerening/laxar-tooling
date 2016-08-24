
# jsonReader

Helper for reading, parsing and caching JSON files.

## Contents

**Module Members**
- [create](#create)

## Module Members
#### <a name="create"></a>create( options )
Create a function to read files from the file system, parses them as JSON an cache the contents.

##### Parameters
| Property | Type | Description |
| -------- | ---- | ----------- |
| _options_ | `Object` |  options |
| _options.log_ | `Logger` |  a logger to log messages in case of error |
| _options.readFile_ | `Function` |  a function accepting a file path as an argument and returning a promise that resolves to the contents of the file |
| _options.fileContents_ | `Object` |  the object to cache file content promises in |

##### Returns
| Type | Description |
| ---- | ----------- |
| `Function` |  a function that returns a `Promise` |