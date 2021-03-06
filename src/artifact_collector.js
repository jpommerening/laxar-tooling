/**
 * Copyright 2016-2017 aixigo AG
 * Released under the MIT license.
 * http://laxarjs.org/license
 */
/**
 * Determine application artifacts by inspecting flow, pages and widgets.
 * @module artifactCollector
 */
'use strict';

/**
 * @external path
 * @see {@link http://nodejs.org/api/path.html}
 * @ignore
 */
import path from 'path';
const { basename, dirname, join } = path;

import { once } from './promise';
import { flatten, values } from './utils';
import defaults from './defaults';

export default { create };

const DOTSLASH = './';
function safeJoin( ...args ) {
   const joined = join(...args);
   const prefix = args[ 0 ].substr(0, 2) === DOTSLASH ? DOTSLASH : '';
   return prefix + joined;
}

/**
 * Create an artifact collector instance.
 *
 * Example:
 *
 *     const collector = laxarTooling.artifactCollector.create( {
 *        paths: { widgets: 'custom/widgets/path' },
 *        resolve: ref => path.relative( base, path.resolve( ref ) ),
 *        readJson: filename => new Promise( ( resolve, reject ) => {
 *           fs.readFile( filename, ( err, contents ) => {
 *              try {
 *                 err ? reject( err ) : resolve( JSON.parse( contents ) );
 *              }
 *              catch( err ) {
 *                 reject( err );
 *              }
 *           } );
 *        } )
 *     } );
 *
 * @param {Object} [options] additional options
 * @param {Object} [options.paths]
 *    configuration where to look for flows, pages, etc.
 * @param {Function} [options.resolve]
 *    a function resolving a given file path to something that can be read by
 *    the `readJson` function and either returning it as a `String` or asynchronously
 * @param {Function} [options.readJson]
 *    a function accepting a file path as an argument and returning a promise
 *    that resolves to the parsed JSON contents of the file as a `Promise`
 * @param {Object} [options.fileContents]
 *    an object mapping file paths (as returned by `options.resolve`) to
 *    promises that resolve to the parsed JSON contents of the file (used if `readJson`
 *    is omitted)
 *
 * @return {ArtifactCollector} the created artifact collector
 */
export function create( options ) {

   const {
      paths,
      resolve,
      readJson
   } = defaults( options );

   const lookup = {
      default: ( ...args ) => lookup.local( ...args )
         .catch( () => lookup.module( ...args ) ),
      local: ( ref, lookupPath ) => resolve( safeJoin( lookupPath, ref ) ),
      module: resolve
   };

   lookup.amd = lookup.module; // backwards compatibility

   function resolveRef( ref, lookupPath ) {
      const parts = ref.split( ':', 2 );
      const path = parts.pop();
      const scheme = parts[ 0 ] || 'default';

      return lookup[ scheme ]( path, lookupPath );
   }

   /**
    * @name ArtifactCollector
    * @constructor
    */
   return {
      collectArtifacts,
      collectSchemas,
      collectFlows,
      collectThemes,
      collectPages,
      collectLayouts,
      collectWidgets,
      collectControls
   };

   //////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Obtain artifact information asynchronously, starting from a set of flow definitions.
    *
    * Example:
    *
    *     collector.collectArtifacts( [ { flows: [ "flow" ], themes: [ "my", "default"  ] } ] )
    *        .then( artifacts => {
    *           assert( Array.isArray( artifacts.flows ) );
    *           assert( Array.isArray( artifacts.themes ) );
    *           assert( Array.isArray( artifacts.pages ) );
    *           assert( Array.isArray( artifacts.layouts ) );
    *           assert( Array.isArray( artifacts.widgets ) );
    *           assert( Array.isArray( artifacts.controls ) );
    *        } );
    *     // => {
    *     //       flows: [ ... ],
    *     //       themes: [ ... ],
    *     //       pages: [ ... ],
    *     //       layouts: [ ... ],
    *     //       widgets: [ ... ],
    *     //       contros: [ ... ]
    *     //    }
    *
    * @memberOf ArtifactCollector
    * @param {Array<Object>} entries
    *   a list of entries containing themes and flows to follow to find all the pages reachable from the
    *   flow and their required artifacts
    * @return {Promise<Object>}
    *   the artifact listing with the keys `flows`, `themes`, `pages`, `layouts`, `widgets` and `controls`,
    *   of which each is an array of artifact objects
    */
   function collectArtifacts( entries ) {
      const add = list => entries.concat( list );

      const flowsPromise = collectFlows( entries );
      const themesPromise = collectThemes( entries );
      const pagesPromise = flowsPromise.then( add ).then( collectPages );
      const layoutsPromise = pagesPromise.then( add ).then( collectLayouts );
      const widgetsPromise = pagesPromise.then( add ).then( collectWidgets );
      const controlsPromise = widgetsPromise.then( add ).then( collectControls );

      return Promise.all( [
         flowsPromise,
         themesPromise,
         pagesPromise,
         layoutsPromise,
         widgetsPromise,
         controlsPromise
      ] ).then( artifacts => {
         const entries = add( flatten( artifacts ) );

         return collectSchemas( entries )
            .then( schemas => artifacts.concat( [ schemas ] ) );
      } )
      .then( ( [ flows, themes, pages, layouts, widgets, controls, schemas ] ) => ( {
         flows,
         themes,
         pages,
         layouts,
         widgets,
         controls,
         schemas,
         entries
      } ) );
   }

   //////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Asynchronously collect all schemas corresponding to the given paths.
    *
    * Example:
    *
    *     collector.collectSchemas( [ { schemas: [ 'schema' ] } ] )
    *        .then( schemas => {
    *           assert( Array.isArray( schemas ) );
    *        } );
    *     // => [ {
    *     //       refs: [ 'schema' ],
    *     //       name: 'schema',
    *     //       path: 'path/to/schema.json',
    *     //       pages: [ ... ]
    *     //    } ]
    *
    *
    * @memberOf ArtifactCollector
    * @param {Array} entries a list of entry objects containing a schemas key
    * @return {Promise<Array>}
    *    a promise for an array of schema-meta objects
    */
   function collectSchemas( entries ) {
      const followSchemaOnce = promiseOnce( followSchema );
      const followEntryToSchemas = followEntryRefs( 'schemas', followSchemaOnce );

      return Promise.all( entries.map( followEntryToSchemas ) )
         .then( flatten )
         .then( dedupe );
   }

   //////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Collect meta information about a single schema.
    *
    * @private
    * @memberOf ArtifactCollector
    * @param {String} schemaRef the schema reference (relative to `paths.schemas`) to follow
    * @return {Promise<Array>} a promise for an array with a single schema-meta object
    */
   function followSchema( schemaRef ) {
      const name = basename( schemaRef );

      return resolveRef( schemaRef + '.json', paths.schemas )
         .then( path => readJson( path ).then( schema => {
            return [ {
               refs: [ schemaRef ],
               name,
               path,
               definition: schema,
               descriptor: { name },
               category: 'schemas'
            } ];
         } ) );
   }

   //////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Asynchronously collect all flows corresponding to the given refs.
    *
    * Example:
    *
    *     collector.collectFlows( [ { flows: [ 'flow' ] } ] )
    *        .then( flows => {
    *           assert( Array.isArray( flows ) );
    *        } );
    *     // => [ {
    *     //       refs: [ 'flow' ],
    *     //       name: 'flow',
    *     //       path: 'path/to/flow.json',
    *     //       pages: [ ... ]
    *     //    } ]
    *
    *
    * @memberOf ArtifactCollector
    * @param {Array} entries a list of entry objects containing a flows key
    * @return {Promise<Array>}
    *    a promise for an array of flow-meta objects
    */
   function collectFlows( entries ) {
      const followFlowOnce = promiseOnce( followFlow );
      const followEntryToFlows = followEntryRefs( 'flows', followFlowOnce );

      return Promise.all( entries.map( followEntryToFlows ) )
         .then( flatten )
         .then( dedupe );
   }

   //////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Collect meta information about a single flow.
    *
    * @private
    * @memberOf ArtifactCollector
    * @param {String} flowRef the flow reference (relative to `paths.flows`) to follow
    * @return {Promise<Array>} a promise for an array with a single flow-meta object
    */
   function followFlow( flowRef ) {
      const name = basename( flowRef );

      return resolveRef( flowRef + '.json', paths.flows )
         .then( path => readJson( path ).then( flow => {
            const pages = values( flow.places )
               .filter( hasField( 'page' ) )
               .map( getField( 'page' ) )
               .filter( unique() );

            return [ {
               refs: [ flowRef ],
               name,
               path,
               definition: flow,
               descriptor: { name },
               category: 'flows',
               schemas: [ 'flow' ],

               pages
            } ];
         } ) );
   }

   //////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Collect meta information on the given themes.
    *
    * Example:
    *
    *     collector.collectThemes( [ { themes: [ 'my.theme', 'default.theme' ] } ] )
    *        .then( themes => {
    *           assert( Array.isArray( themes ) );
    *        } );
    *     // => [ {
    *     //       refs: [ 'my.theme' ],
    *     //       name: 'my.theme',
    *     //       path: 'path/to/my.theme'
    *     //    }, {
    *     //       refs: [ 'default.theme' ],
    *     //       name: 'default.theme',
    *     //       path: 'path/to/laxar-uikit/themes/default.theme'
    *     //    } ]
    *
    * @memberOf ArtifactCollector
    * @param {Array<Object>} entries
    *   a list of entries with themes to include in the artifacts
    * @return {Promise<Array>}
    *   a promise for an array of meta-information about all themes
    */
   function collectThemes( entries ) {
      const followThemeOnce = promiseOnce( followTheme );
      const followEntryToThemes = followEntryRefs( 'themes', followThemeOnce );

      return Promise.all( entries.map( followEntryToThemes ) )
         .then( flatten )
         .then( dedupe );
   }

   //////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Collect meta information about the single theme. If the theme is the default theme, and a custom
    * path was configured with `paths[ 'default-theme' ]` resolve the theme at the given path; otherwise
    * treat it like any other theme.
    *
    * @private
    * @memberOf ArtifactCollector
    * @param {String} themeRef the theme reference (relative to `paths.themes`) to follow
    * @return {Promise<Array>} a promise for an array with a single theme-meta object
    */
   function followTheme( themeRef ) {
      const lookupRef = themeRef === 'default' ? paths[ 'default-theme' ] : `${themeRef}.theme`;

      return resolveRef( join( lookupRef, 'theme.json' ), paths.themes )
         .then( descriptorPath => readJson( descriptorPath ).then( theme => {
            const path = dirname( descriptorPath );
            const name = theme.name;
            if( !name ) {
               return Promise.reject( 'Theme descriptor is missing name: ', path );
            }

            return [ {
               refs: [ themeRef ],
               name,
               path,
               descriptor: theme,
               category: 'themes',
               schemas: [ 'theme' ]
            } ];
         } ) );
   }

   //////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Asynchronously collect all pages that are reachable from the given list of flows.
    *
    * Example:
    *
    *     collector.collectPages( flows )
    *        .then( pages => {
    *           assert( Array.isArray( pages ) );
    *        } );
    *     // => [ {
    *     //       refs: [ 'page' ],
    *     //       name: 'page',
    *     //       path: 'path/to/page.json',
    *     //       pages: [ ... ],
    *     //       layouts: [ ... ],
    *     //       widgets: [ ... ]
    *     //    }, ... ]
    *
    * @memberOf ArtifactCollector
    * @param {Array<String>} flows
    *    a list of flow artifacts as returned by {@link ArtifactCollector#collectFlows}
    * @return {Promise<Array>}
    *   a promise for a combined array of page meta information for these flows
    */
   function collectPages( flows ) {
      const followPageOnce = promiseOnce( followPageRecursively );
      const followFlowToPages = followEntryRefs( 'pages', followPageOnce );
      const followPageToPages = followFlowToPages;

      return Promise.all( flows.map( followFlowToPages ) )
         .then( flatten )
         .then( dedupe );

      ///////////////////////////////////////////////////////////////////////////////////////////////////////

      /**
       * Collect meta information about the given page, and about all pages reachable from it, recursively.
       * Skip collection if the page has already been processed (returning an empty result array).
       *
       * @private
       * @param {String} pageRef the page reference (relative to `paths.pages`) to follow
       * @return {Promise<Array>}
       *    a promise for an array of page-meta objects for this page, including the page itself
       */
      function followPageRecursively( pageRef ) {
         return followPage( pageRef )
            .then( pages => Promise.all(
               [ Promise.resolve( pages ) ].concat( pages.map( followPageToPages ) )
            ) )
            .then( flatten );
      }
   }

   //////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Collect meta information about the single page.
    *
    * @private
    * @memberOf ArtifactCollector
    * @param {String} pageRef the page reference (relative to `paths.pages`) to follow
    * @return {Promise<Array>} a promise for an array with a single page-meta object
    */
   function followPage( pageRef ) {
      const name = basename( pageRef );

      return resolveRef( pageRef + '.json', paths.pages )
         .then( path => readJson( path ).then( page => {
            const items = flatten( values( page.areas ) )
               .filter( item => item.enabled !== false );

            const pages = items
               .filter( hasField( 'composition' ) )
               .map( getField( 'composition' ) )
               .concat( page.extends ? [ page.extends ] : [] );

            const layouts = items
               .filter( hasField( 'layout' ) )
               .map( getField( 'layout' ) )
               .concat( page.layout ? [ page.layout ] : [] )
               .filter( unique() );

            const widgets = items
               .filter( hasField( 'widget' ) )
               .map( getField( 'widget' ) )
               .filter( unique() );

            return [ {
               refs: [ pageRef ],
               path,
               name,
               definition: page,
               descriptor: { name },
               category: 'pages',
               schemas: [ 'page' ],

               pages,
               widgets,
               layouts
            } ];
         } ) );
   }

   //////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Finds layouts based on them being referenced in page areas.
    *
    * Example:
    *
    *     collector.collectLayouts( pages )
    *        .then( layouts => {
    *           assert( Array.isArray( layouts ) );
    *        } );
    *     // => [ {
    *     //       refs: [ 'layout' ],
    *     //       name: 'layout',
    *     //       path: 'path/to/layout'
    *     //    }, ... ]
    *
    * @memberOf ArtifactCollector
    * @param {Array} pages
    *    a list of page artifacts as returned by {@link ArtifactCollector#collectPages}
    * @return {Promise<Array>}
    *   a promise for an array of meta-information about all layouts
    */
   function collectLayouts( pages ) {
      const followLayoutOnce = promiseOnce( followLayout );
      const followPageToLayouts = followEntryRefs( 'layouts', followLayoutOnce );

      return Promise.all( pages.map( followPageToLayouts ) )
         .then( flatten )
         .then( dedupe );
   }

   //////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Collect meta information about a single layout.
    *
    * @private
    * @memberOf ArtifactCollector
    * @param {String} layoutRef the layout reference (relative to `paths.layouts`) to follow
    * @return {Promise<Array>} a promise for an array containing meta-formation about a single layout
    */
   function followLayout( layoutRef ) {
      return resolveRef( join( layoutRef, 'layout.json' ), paths.layouts )
         .then( descriptorPath => readJson( descriptorPath ).then( layout => {
            const path = dirname( descriptorPath );
            const name = layout.name;

            return [ {
               refs: [ layoutRef ],
               name,
               path,
               descriptor: layout,
               category: 'layouts',
               schemas: [ 'layout' ]
            } ];
         } ) );
   }

   //////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Collect meta information on all widget that are referenced from the given pages.
    *
    * Example:
    *
    *     collector.collectWidgets( pages )
    *        .then( widgets => {
    *           assert( Array.isArray( widgets ) );
    *        } );
    *     // => [ {
    *     //       refs: [ 'widget' ],
    *     //       name: 'widget',
    *     //       path: 'path/to/widget',
    *     //       controls: [ ... ]
    *     //    }, ... ]
    *
    * @memberOf ArtifactCollector
    * @param {Array} pages
    *    a list of page artifacts as returned by {@link ArtifactCollector#collectPages}
    * @return {Promise<Array>}
    *   a promise for an array of meta-information about all reachable widgets
    */
   function collectWidgets( pages ) {
      const followWidgetOnce = promiseOnce( followWidget );
      const followPageToWidgets = followEntryRefs( 'widgets', followWidgetOnce );

      return Promise.all( pages.map( followPageToWidgets ) )
         .then( flatten )
         .then( dedupe );
   }

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Collect meta information about a single widget.
    *
    * @private
    * @memberOf ArtifactCollector
    * @param {String} widgetRef the widget reference (relative to `paths.widgets`) to follow
    * @return {Promise<Array>} a promise for an array containing meta-formation about a single widget
    */
   function followWidget( widgetRef ) {
      return resolveRef( join( widgetRef, 'widget.json' ), paths.widgets )
         .then( descriptorPath => readJson( descriptorPath ).then( widget => {
            const path = dirname( descriptorPath );
            const name = widget.name;
            if( !name ) {
               return Promise.reject( 'Widget descriptor is missing name: ', path );
            }
            const controls = widget.controls;

            return [ {
               refs: [ widgetRef ],
               name,
               path,
               descriptor: widget,
               category: 'widgets',
               schemas: [ 'widget' ],

               controls
            } ];
         } ) );
   }

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Collect meta information on all controls that are referenced by the given widgets.
    *
    * Example:
    *
    *     collector.collectControls( widgets, themes )
    *        .then( controls => {
    *           assert( Array.isArray( controls ) );
    *        } );
    *     // => [ {
    *     //       refs: [ 'control' ],
    *     //       name: 'control',
    *     //       path: 'path/to/control',
    *     //       controls: [ ... ]
    *     //    }, ... ]
    *
    * @memberOf ArtifactCollector
    * @param {Array} widgets
    *    a list of widget artifacts as returned by {@link ArtifactCollector#collectWidgets}
    * @return {Promise<Array>}
    *   a promise for an array of meta-information about all reachable controls
    */
   function collectControls( widgets ) {
      const followControlOnce = promiseOnce( followControlRecursively );
      const followWidgetToControls = followEntryRefs( 'controls', followControlOnce );
      const followControlToControls = followWidgetToControls;

      return Promise.all( widgets.map( followWidgetToControls ) )
         .then( flatten )
         .then( dedupe );

      ///////////////////////////////////////////////////////////////////////////////////////////////////////

      /**
       * Collect meta information about the given control, and about all controls it references, recursively.
       * Skip collection if the control has already been processed (returning an empty result array).
       *
       * @private
       * @param {String} controlRef the control reference (relative to `paths.controls`) to follow
       * @return {Promise<Array>}
       *    a promise for an array of control-meta objects for this control, including the control itself
       */
      function followControlRecursively( controlRef ) {
         return followControl( controlRef )
            .then( controls => Promise.all(
               [ Promise.resolve( controls ) ].concat( controls.map( followControlToControls ) )
            ) )
            .then( flatten );
      }
   }

   ///////////////////////////////////////////////////////////////////////////////////////////////////////////

   /**
    * Collect meta information about a single control.
    *
    * @private
    * @memberOf ArtifactCollector
    * @param {String} controlRef the control reference (relative to `paths.controls`) to follow
    * @return {Promise<Array>} a promise for an array containing meta-formation about a single control
    */
   function followControl( controlRef ) {
      return resolveRef( join( controlRef, 'control.json' ), paths.controls )
         .then( descriptorPath => readJson( descriptorPath ).then( control => {
            const path = dirname( descriptorPath );
            const name = control.name;
            const controls = control.controls;
            if( !name ) {
               return Promise.reject( 'Control descriptor is missing name: ', path );
            }

            return [ {
               refs: [ controlRef ],
               name,
               path,
               descriptor: control,
               category: 'controls',
               schemas: [ 'control' ],

               controls
            } ];
         } ) );
   }

}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Decorate a function so that each input is processed only once.
 * The function should take a string and return a promise for an array.
 * Subsequent calls will return a (resolved) promise for an empty array.
 *
 * @private
 * @param {Function} f the function to decorate
 * @return {Function} the wrapped function
 */
function promiseOnce( f ) {
   return once( f, {}, () => ( [] ) );
}

/**
 * Create a function that expects an artifact entry as a parameter and follows the given key of it with
 * a given function.
 *
 * @private
 * @param {String} key the key to follow
 * @param {Function} callback the function to call for each ref listed in the key
 * @return {Function} a function returning a promise for a list of entries returned by callback
 */
function followEntryRefs( key, callback ) {
   return function( entry ) {
      const refs = entry[ key ] || [];
      return Promise.all( refs.map( callback ) ).then( flatten );
   };
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////

function hasField( field ) {
   return function( value ) {
      return value.hasOwnProperty( field );
   };
}

function getField( field ) {
   return function( value ) {
      return value[ field ];
   };
}

function dedupe( entries ) {
   const refs = entries.reduce( ( map, { name, refs } ) => ( {
      ...map,
      [ name ]: map[ name ] ? map[ name ].concat( refs ) : refs
   } ), {} );

   return entries
      .filter( unique( 'name' ) )
      .map( ( { name, ...entry } ) => ( {
         ...entry,
         name,
         refs: refs[ name ].filter( unique )
      } ) );
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////

function unique( field ) {
   const seen = {};
   const id = field ? value => value[ field ] : value => value;

   return value => {
      const key = id( value );
      if( seen[ key ] ) {
         return false;
      }
      seen[ key ] = true;
      return true;
   };
}
