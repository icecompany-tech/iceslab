import { StatsRow } from '@/contours/users/components/UsersTable/StatsRow';
import { UsersTable } from '@/contours/users/components/UsersTable/UsersTable';
import { UsersToolbar } from '@/contours/users/components/UsersTable/UsersToolbar';
import { useUsersPage } from '@/contours/users/screens/useUsersPage';
import { Box, Stack } from '@mantine/core';
import { GROUND } from '@/contours/users/lib/colors';
// One definition of "online" for the whole panel: the dashboard used to count a
// 3-minute window while this list glowed for 5.
import { type CreateUserInput, type UpdateUserInput } from '@/lib/domain/users';
import { UserDrawer } from '@/contours/users/components/UserDrawer';

// ───── Helpers ─────

export function UsersPage() {
  const {
    qc,
    activeFilters,
    toggleSort,
    usersQuery,
    squadsQuery,
    knownTags,
    authStatusQuery,
    squadNameById,
    pagedUsers,
    totalUsers,
    stats,
    totalPages,
    safePage,
    rangeStart,
    rangeEnd,
    createMutation,
    updateMutation,
    handleRevoke,
    handleRotate,
    handleResetTraffic,
    handleDelete,
    editing,
    setEditing,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    sort,
    order,
    squadFilter,
    setSquadFilter,
    tagFilter,
    setTagFilter,
    routingFilter,
    setRoutingFilter,
    createOpen,
    openCreate,
    closeCreate,
    colFilters,
    setColFilter,
    selected,
    setSelected,
    toggleSelected,
    columnView,
    setColumnView,
    visibleColumns,
    toggleColumn,
    pinColumn,
    moveColumn,
    density,
    cycleDensity,
    fullscreen,
    setFullscreen,
    colParams,
    setFilterParam,
    clearFilterParams,
  } = useUsersPage();

  const table = (
    <UsersTable toggleSort={toggleSort} authStatusQuery={authStatusQuery} squadNameById={squadNameById} pagedUsers={pagedUsers} totalUsers={totalUsers} stats={stats} totalPages={totalPages} safePage={safePage} rangeStart={rangeStart} rangeEnd={rangeEnd} handleRevoke={handleRevoke} handleRotate={handleRotate} handleResetTraffic={handleResetTraffic} handleDelete={handleDelete} setEditing={setEditing} setPage={setPage} rowsPerPage={rowsPerPage} setRowsPerPage={setRowsPerPage} sort={sort} order={order} statusFilter={statusFilter} setStatusFilter={setStatusFilter} colFilters={colFilters} setColFilter={setColFilter} selected={selected} setSelected={setSelected} toggleSelected={toggleSelected} activeFilters={activeFilters} columnView={columnView} setColumnView={setColumnView} visibleColumns={visibleColumns} toggleColumn={toggleColumn} pinColumn={pinColumn} moveColumn={moveColumn} density={density} cycleDensity={cycleDensity} fullscreen={fullscreen} setFullscreen={setFullscreen} openCreate={openCreate} colParams={colParams} setFilterParam={setFilterParam} clearFilterParams={clearFilterParams} />
  );

  // Full screen is the same table with the room the rest of the page was
  // taking: the KPI chips and the search bar are a way in, and once you are
  // reading twenty-three columns they are in the way.
  if (fullscreen) {
    return (
      <Box
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 200,
          backgroundColor: GROUND,
          padding: 16,
          overflowY: 'auto',
        }}
      >
        {table}
      </Box>
    );
  }

  return (
    <Stack gap="lg">
      <StatsRow stats={stats} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />

      <UsersToolbar qc={qc} activeFilters={activeFilters} usersQuery={usersQuery} squadsQuery={squadsQuery} knownTags={knownTags} search={search} setSearch={setSearch} squadFilter={squadFilter} setSquadFilter={setSquadFilter} tagFilter={tagFilter} setTagFilter={setTagFilter} routingFilter={routingFilter} setRoutingFilter={setRoutingFilter} openCreate={openCreate} />

      {table}

      <UserDrawer
        opened={createOpen}
        onClose={closeCreate}
        user={null}
        loading={createMutation.isPending}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input as CreateUserInput);
        }}
      />

      <UserDrawer
        opened={editing !== null}
        onClose={() => setEditing(null)}
        user={editing}
        loading={updateMutation.isPending}
        onResetTraffic={handleResetTraffic}
        onRevoke={handleRevoke}
        onDelete={handleDelete}
        onSubmit={async (input) => {
          if (!editing) return;
          await updateMutation.mutateAsync({ id: editing.id, input: input as UpdateUserInput });
        }}
      />
    </Stack>
  );
}

// The presence dot lived here. The pill says ONLINE or OFFLINE in a word now,
// so a mark repeating it in colour would have made three signs for one fact,
// counting the last-online column. A word reads better than a mark, so the mark
// is what went.

