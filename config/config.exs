# This file is responsible for configuring your application
# and its dependencies with the aid of the Mix.Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
use Mix.Config

config :chatx,
  ecto_repos: [Chatx.Repo]

# Configures the endpoint
config :chatx, ChatxWeb.Endpoint,
  url: [host: "localhost"],
  secret_key_base: "WOXfHg7beShc+ieo8nsVZ/6IVWidYKAtaxEfV6FGPlKhZokSXrJL58Hd+7Hi+/Ug",
  render_errors: [view: ChatxWeb.ErrorView, accepts: ~w(html json)],
  pubsub: [name: Chatx.PubSub, adapter: Phoenix.PubSub.PG2]

# Configures Elixir's Logger
config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{Mix.env()}.exs"
