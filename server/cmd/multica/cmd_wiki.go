package main

import (
	"context"
	"fmt"
	"net/url"
	"os"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

var wikiCmd = &cobra.Command{
	Use:   "wiki",
	Short: "Work with wiki pages",
}

var wikiPageCmd = &cobra.Command{
	Use:   "page",
	Short: "Work with wiki pages",
}

var wikiPageListCmd = &cobra.Command{
	Use:   "list",
	Short: "List wiki pages in the workspace",
	RunE:  runWikiPageList,
}

var wikiPageGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get a wiki page",
	Args:  exactArgs(1),
	RunE:  runWikiPageGet,
}

var wikiPageCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new wiki page",
	RunE:  runWikiPageCreate,
}

var wikiPageProposeCmd = &cobra.Command{
	Use:   "propose <page-id>",
	Short: "Propose a revision to an existing wiki page (awaits human approval)",
	Args:  exactArgs(1),
	RunE:  runWikiPagePropose,
}

func init() {
	wikiCmd.AddCommand(wikiPageCmd)

	wikiPageCmd.AddCommand(wikiPageListCmd)
	wikiPageCmd.AddCommand(wikiPageGetCmd)
	wikiPageCmd.AddCommand(wikiPageCreateCmd)
	wikiPageCmd.AddCommand(wikiPageProposeCmd)

	// wiki page list
	wikiPageListCmd.Flags().String("output", "table", "Output format: table or json")

	// wiki page get
	wikiPageGetCmd.Flags().String("output", "json", "Output format: table or json")

	// wiki page create
	wikiPageCreateCmd.Flags().String("title", "", "Page title (required)")
	wikiPageCreateCmd.Flags().String("content", "", "Page content (decodes \\n, \\r, \\t, \\\\; use --content-file to preserve literal backslashes)")
	wikiPageCreateCmd.Flags().Bool("content-stdin", false, "Read page content from stdin (preserves multi-line content verbatim)")
	wikiPageCreateCmd.Flags().String("content-file", "", "Read page content from a UTF-8 file (preserves multi-line content verbatim; preferred for agent-authored bodies)")
	wikiPageCreateCmd.Flags().String("parent", "", "Parent page ID (optional)")
	wikiPageCreateCmd.Flags().String("output", "json", "Output format: table or json")

	// wiki page propose
	wikiPageProposeCmd.Flags().String("title", "", "Revised title (required)")
	wikiPageProposeCmd.Flags().String("content", "", "Revised content (decodes \\n, \\r, \\t, \\\\; use --content-file to preserve literal backslashes)")
	wikiPageProposeCmd.Flags().Bool("content-stdin", false, "Read revised content from stdin (preserves multi-line content verbatim)")
	wikiPageProposeCmd.Flags().String("content-file", "", "Read revised content from a UTF-8 file (preserves multi-line content verbatim; preferred for agent-authored bodies)")
	wikiPageProposeCmd.Flags().String("summary", "", "Short summary of the proposed changes (optional)")
	wikiPageProposeCmd.Flags().String("output", "json", "Output format: table or json")
}

// ---------------------------------------------------------------------------
// Wiki page commands
// ---------------------------------------------------------------------------

func runWikiPageList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	params := url.Values{}
	if client.WorkspaceID != "" {
		params.Set("workspace_id", client.WorkspaceID)
	}

	path := "/api/wiki/pages"
	if len(params) > 0 {
		path += "?" + params.Encode()
	}

	var result map[string]any
	if err := client.GetJSON(ctx, path, &result); err != nil {
		return fmt.Errorf("list wiki pages: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, result)
	}

	pagesRaw, _ := result["pages"].([]any)
	headers := []string{"ID", "TITLE", "SLUG"}
	rows := make([][]string, 0, len(pagesRaw))
	for _, raw := range pagesRaw {
		page, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		rows = append(rows, []string{
			strVal(page, "id"),
			strVal(page, "title"),
			strVal(page, "slug"),
		})
	}
	cli.PrintTable(os.Stdout, headers, rows)
	return nil
}

func runWikiPageGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	pageID := args[0]
	var page map[string]any
	if err := client.GetJSON(ctx, "/api/wiki/pages/"+url.PathEscape(pageID), &page); err != nil {
		return fmt.Errorf("get wiki page: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		headers := []string{"ID", "TITLE", "SLUG", "CONTENT"}
		rows := [][]string{{
			strVal(page, "id"),
			strVal(page, "title"),
			strVal(page, "slug"),
			strVal(page, "content"),
		}}
		cli.PrintTable(os.Stdout, headers, rows)
		return nil
	}

	return cli.PrintJSON(os.Stdout, page)
}

func runWikiPageCreate(cmd *cobra.Command, _ []string) error {
	title, _ := cmd.Flags().GetString("title")
	if title == "" {
		return fmt.Errorf("--title is required")
	}

	content, hasContent, err := resolveTextFlag(cmd, "content")
	if err != nil {
		return err
	}
	if !hasContent {
		return fmt.Errorf("--content, --content-stdin, or --content-file is required")
	}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	body := map[string]any{
		"title":   title,
		"content": content,
	}
	if parentID, _ := cmd.Flags().GetString("parent"); parentID != "" {
		body["parent_id"] = parentID
	}

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/wiki/pages", body, &result); err != nil {
		return fmt.Errorf("create wiki page: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Wiki page created: %s\n", strVal(result, "id"))

	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		headers := []string{"ID", "TITLE", "SLUG"}
		rows := [][]string{{
			strVal(result, "id"),
			strVal(result, "title"),
			strVal(result, "slug"),
		}}
		cli.PrintTable(os.Stdout, headers, rows)
		return nil
	}

	return cli.PrintJSON(os.Stdout, result)
}

func runWikiPagePropose(cmd *cobra.Command, args []string) error {
	pageID := args[0]

	title, _ := cmd.Flags().GetString("title")
	if title == "" {
		return fmt.Errorf("--title is required")
	}

	content, hasContent, err := resolveTextFlag(cmd, "content")
	if err != nil {
		return err
	}
	if !hasContent {
		return fmt.Errorf("--content, --content-stdin, or --content-file is required")
	}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	body := map[string]any{
		"title":   title,
		"content": content,
	}
	if summary, _ := cmd.Flags().GetString("summary"); summary != "" {
		body["summary"] = summary
	}

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/wiki/pages/"+url.PathEscape(pageID)+"/revisions", body, &result); err != nil {
		return fmt.Errorf("propose wiki revision: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Revision proposed (ID: %s) — awaits human review before going live.\n", strVal(result, "id"))

	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		headers := []string{"REVISION ID", "PAGE ID", "TITLE"}
		rows := [][]string{{
			strVal(result, "id"),
			pageID,
			strVal(result, "title"),
		}}
		cli.PrintTable(os.Stdout, headers, rows)
		return nil
	}

	return cli.PrintJSON(os.Stdout, result)
}
