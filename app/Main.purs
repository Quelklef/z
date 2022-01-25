module Main where

import Prelude
import Effect (Effect)
import Effect.Class (liftEffect)
import Effect.Uncurried (runEffectFn1)
import Effect.Aff (launchAff_)
import Data.Generic.Rep (class Generic)
import Control.Promise (Promise, toAffE)
import Control.Monad.Writer.Class (tell)

import Platform (Update, app, Cmd (..), afterRender)
import Html (Html)
import Html as H

foreign import data Note :: Type

foreign import getNotes :: Effect (Promise (Array Note))

foreign import renderForView :: Note -> { html :: String }
foreign import renderIndex :: Array Note -> { html :: String }

foreign import establish :: (Note -> Effect Unit) -> Effect Unit
foreign import doKatex :: Effect Unit


type Model =
  { page :: Page
  , notes :: Array Note
  }

data Page = Index | View Note

derive instance Generic Page _

data Message = NavTo Page

derive instance Generic Message _



update :: Model -> Message -> Update Message Model
update model (NavTo page) = pure $ model { page = page }


view :: Model -> { head :: Array (Html Message), body :: Array (Html Message) }
view model = case model.page of
  Index -> fromBody $ H.rawHtml (renderIndex model.notes).html
  View note -> fromBody $ H.rawHtml (renderForView note).html

  where
  fromBody body = { head: [], body: [body] }


main :: Effect Unit
main = do

  let
    reestablish :: Update Message Unit
    reestablish = do
      tell $ Cmd \sendMsg -> do
        establish \note -> sendMsg (NavTo $ View note)

  launchAff_ do
    notes <- toAffE getNotes

    let init _ = reestablish $> model0 notes

    liftEffect $ flip runEffectFn1 unit $
      app
        { init
        , update: \model msg -> do
            reestablish
            afterRender doKatex
            update model msg
        , view
        , subscriptions: mempty
        }

  where

  model0 notes =
    { page: Index
    , notes
    }
