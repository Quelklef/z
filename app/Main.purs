module Main where

import Prelude

import Effect (Effect)

foreign import fmain :: Effect Unit

main :: Effect Unit
main = fmain
