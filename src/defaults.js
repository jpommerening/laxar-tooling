/**
 * Copyright 2016 aixigo AG
 * Released under the MIT license.
 * http://laxarjs.org/license
 */
/**
 * Default paths and options
 * @module defaultLogger
 */
'use strict';

import assetResolver from './asset_resolver';

import { wrap } from './promise';

const DEFAULT_PATHS = {
   flows: './flows',
   themes: './themes',
   pages: './pages',
   layouts: './layouts',
   widgets: './widgets',
   controls: './controls',
   'default-theme': 'default.theme'
};

const DEFAULT_LOGGER = {
   error() {},
   warn() {}
};

/**
 * Provide defaults for interdependent options.
 * Some `laxar-tooling` options occur in multiple modules and are expected to
 * have consistent defaults. These defaults may depend on the value of other
 * options. To avoid repeating these dynamic defaults throughout many modules
 * they are handled by this function.
 *
 * Construction of "expensive" defaults is delayed until use and cached for
 * subsequent use.
 *
 * @param {Object} [options] some options
 * @return {Object} options with defaults applied
 */
export default function( options = {} ) {
   const log = {
      ...DEFAULT_LOGGER,
      ...options.log
   };
   const paths = {
      ...DEFAULT_PATHS,
      ...options.paths
   };

   return {
      log,
      paths,
      get resolve() {
         return wrap( options.resolve );
      },
      get readJson() {
         if( !options.readJson ) {
            throw new Error( 'Required option "readJson" missing' );
         }
         return wrap( options.readJson );
      },
      get assetResolver() {
         if( !options.assetResolver ) {
            options.assetResolver = assetResolver.create( this );
         }

         return options.assetResolver;
      }
   };
}
