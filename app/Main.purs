module Main where

import Prelude
import Effect (Effect)
import Effect.Class (liftEffect)
import Effect.Uncurried (runEffectFn1)
import Effect.Aff (launchAff_)
import Data.Maybe (Maybe (..))
import Data.Nullable (Nullable, toMaybe)
import Data.Generic.Rep (class Generic)
import Control.Promise (Promise, toAffE)
import Control.Monad.Writer.Class (tell)

import Platform (Update, app, Cmd (..), afterRender)
import Html (Html)
import Html as H

foreign import data Note :: Type

foreign import getNotes :: Effect (Promise (Array Note))
foreign import loadNote :: Array Note -> Effect (Nullable Note)

foreign import renderForView :: Note -> { html :: String }
foreign import renderIndex :: Array Note -> { html :: String }

foreign import establish :: (Note -> Effect Unit) -> Effect Unit
foreign import doKatex :: Effect Unit
foreign import doTikz :: Effect Unit


type Model =
  { page :: Page
  , notes :: Array Note
  }

data Page = Index | View Note

derive instance Generic Page _

data Msg = NavTo Page

derive instance Generic Msg _



updateImpl :: Model -> Msg -> Update Msg Model
updateImpl model (NavTo page) = pure $ model { page = page }


view :: Model -> { head :: Array (Html Msg), body :: Array (Html Msg) }
view model = case model.page of
  Index -> fromBody $ H.rawHtml (renderIndex model.notes).html
  View note -> fromBody $ H.rawHtml (renderForView note).html

  where
  fromBody body = { head: [], body: [body] }


main :: Effect Unit
main = launchAff_ do

  notes <- toAffE getNotes
  mInitNote <- liftEffect $ toMaybe <$> loadNote notes

  liftEffect $ flip runEffectFn1 unit $

      app
        { init: \_ -> do
            reestablish
            afterRender doKatex
            afterRender doTikz
            let page = case mInitNote of
                  Nothing -> Index
                  Just n -> View n
            pure $ { notes, page }
        , update
        , view
        , subscriptions: mempty
        }


  where

  reestablish :: Update Msg Unit
  reestablish = do
    tell $ Cmd \sendMsg -> do
      establish \note -> sendMsg (NavTo $ View note)

  update :: Model -> Msg -> Update Msg Model
  update model msg = do
    reestablish
    afterRender doKatex
    updateImpl model msg
