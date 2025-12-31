using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations.Auto
{
    /// <inheritdoc />
    public partial class AddDocumentReplacementTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_active",
                table: "shipment_documents",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "replaced_at",
                table: "shipment_documents",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "replaced_by_document_id",
                table: "shipment_documents",
                type: "bigint",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "is_active",
                table: "shipment_documents");

            migrationBuilder.DropColumn(
                name: "replaced_at",
                table: "shipment_documents");

            migrationBuilder.DropColumn(
                name: "replaced_by_document_id",
                table: "shipment_documents");
        }
    }
}
