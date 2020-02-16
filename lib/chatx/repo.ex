defmodule Chatx.Repo do
  use Ecto.Repo,
    otp_app: :chatx,
    adapter: Ecto.Adapters.Postgres
end
