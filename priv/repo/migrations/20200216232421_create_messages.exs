defmodule Chatx.Repo.Migrations.CreateMessages do
  use Ecto.Migration

  def change do
    create table(:messages) do
      add :username, :string
      add :text, :text

      timestamps()
    end

  end
end
